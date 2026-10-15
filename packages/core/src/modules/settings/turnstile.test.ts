import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { closeContext } from "../../context";
import { execute, getOperation } from "../../index";
import { getAuth, TURNSTILE_HEADER } from "../auth";
import { registerEmailJobs } from "../email";
import { registerAccountEmailJobs } from "../email/account";
import { SITEVERIFY_TIMEOUT_MS } from "./turnstile";

const ORIGIN = "http://localhost:3000";
const PASSWORD = "Password123!";
const SECRET = "0x4AAAAAAA-test-secret-do-not-leak";
const SITE_KEY = "0x4AAAAAAA-test-site-key";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const opened: ReturnType<typeof createTestContext>[] = [];
let addresses = 0;
afterEach(() => {
  for (const ctx of opened.splice(0)) closeContext(ctx);
});

type Verdict =
  | { success: boolean; "error-codes"?: string[]; action?: string; hostname?: string }
  | Response
  | Error;

/** The form of the request being sent, which the scripted widget names as its action. */
let formOfRequest = "register";
const FORM_OF_PATH: Record<string, string> = {
  "/sign-up/email": "register",
  "/sign-in/email": "login",
  "/sign-in/username": "login",
  "/request-password-reset": "passwordReset",
  "/send-verification-email": "resendConfirmation",
};

/** Cloudflare, scripted: each call to siteverify answers the next verdict (the last one repeats). */
function cloudflare(...verdicts: Verdict[]) {
  // biome-ignore lint/suspicious/noExplicitAny: replaces a spy an earlier call set
  (globalThis.fetch as any).mockRestore?.();
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const spy = spyOn(globalThis, "fetch").mockImplementation((async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ) => {
    const url = String(input);
    if (url !== SITEVERIFY) throw new Error(`unexpected network call to ${url}`);
    calls.push({ url, init: init ?? {}, body: JSON.parse(String(init?.body)) });
    const verdict = verdicts[Math.min(calls.length, verdicts.length) - 1]!;
    if (verdict instanceof Error) throw verdict;
    if (verdict instanceof Response) return verdict;
    // A good answer names the form's action and the site's host unless the test says otherwise.
    if ("success" in verdict && verdict.success && !("action" in verdict))
      return Response.json({ ...verdict, action: formOfRequest, hostname: "localhost" });
    return Response.json(verdict);
  }) as unknown as typeof fetch);
  return { calls, spy };
}

afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: restores the global the spies replaced
  (globalThis.fetch as any).mockRestore?.();
});

function site(options: { mail?: boolean } = {}) {
  const ctx = createTestContext();
  opened.push(ctx);
  if (options.mail) {
    registerEmailJobs(
      ctx,
      { driver: "capture", sender: "forum@example.test" },
      { defaults: {}, securityTypes: new Set() },
    );
    registerAccountEmailJobs(ctx);
  }
  const admin = insertUser(ctx, { groupId: 4 });
  const adminActor = userActor(admin);
  const call = (name: string, actor: object, input: object = {}) =>
    // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
    execute(ctx, getOperation(name), actor as never, input) as Promise<any>;
  const settings = (changes: object) => call("settings.update", adminActor, changes);
  const enable = (changes: object = {}) =>
    settings({
      turnstileEnabled: true,
      turnstileSiteKey: SITE_KEY,
      turnstileSecret: SECRET,
      ...changes,
    });
  const auth = getAuth(ctx);
  const post = (
    path: string,
    body: unknown,
    options: { token?: string; cookie?: string; ip?: string | null } = {},
  ) => {
    formOfRequest = FORM_OF_PATH[path] ?? formOfRequest;
    return auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          ...(options.ip === null
            ? {}
            : { "x-sermo-client-ip": options.ip ?? `198.51.100.${++addresses}` }),
          ...(options.token === undefined ? {} : { [TURNSTILE_HEADER]: options.token }),
          ...(options.cookie ? { cookie: options.cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  };
  const signUp = (name: string, options: Parameters<typeof post>[2] = {}) =>
    post(
      "/sign-up/email",
      { name, username: name, email: `${name.toLowerCase()}@example.test`, password: PASSWORD },
      options,
    );
  return { ctx, admin, adminActor, call, settings, enable, post, signUp };
}

const accounts = (s: { ctx: { sqlite: import("bun:sqlite").Database } }) =>
  s.ctx.sqlite.query<{ n: number }, []>("SELECT count(*) AS n FROM auth_user").get()!.n;
const codeOf = async (response: Response) => ((await response.json()) as { code?: string }).code;
const cookieOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

describe("settings", () => {
  test("off by default: nothing is asked and nothing is sent to Cloudflare", async () => {
    const s = site();
    const cf = cloudflare({ success: true });
    expect((await s.signUp("Alice")).status).toBe(200);
    expect((await s.signUp("Bob", { token: "ignored" })).status).toBe(200);
    expect(cf.calls).toHaveLength(0);
    const read = await s.call("settings.get", s.adminActor);
    expect(read).toMatchObject({
      turnstileEnabled: false,
      turnstileSiteKey: "",
      turnstileSecretSet: false,
      // Sign-in is not guarded by default: a wrong secret must not lock the administrator out.
      turnstileForms: ["register", "passwordReset", "resendConfirmation"],
    });
    expect((await s.call("site.get", {}, {})).turnstile).toBeNull();
  });

  test("it cannot be turned on without a site key and a secret, nor stripped while on", async () => {
    const s = site();
    await expect(s.settings({ turnstileEnabled: true })).rejects.toThrow(/site key and a secret/);
    await expect(
      s.settings({ turnstileEnabled: true, turnstileSiteKey: SITE_KEY }),
    ).rejects.toThrow(/site key and a secret/);
    await expect(s.settings({ turnstileEnabled: true, turnstileSecret: SECRET })).rejects.toThrow(
      /site key and a secret/,
    );
    // Nothing was stored by the refused calls.
    expect((await s.call("settings.get", s.adminActor)).turnstileSecretSet).toBe(false);
    await s.enable();
    await expect(s.settings({ turnstileSecret: null })).rejects.toThrow(/site key and a secret/);
    await expect(s.settings({ turnstileSiteKey: "" })).rejects.toThrow(/site key and a secret/);
    expect((await s.call("settings.get", s.adminActor)).turnstileSecretSet).toBe(true);
    await s.settings({ turnstileEnabled: false });
    await s.settings({ turnstileSecret: null });
    expect((await s.call("settings.get", s.adminActor)).turnstileSecretSet).toBe(false);
  });

  test("the secret is write-only: no read, output, log or stored configuration carries it", async () => {
    const s = site();
    const saved = await s.enable();
    expect(saved.turnstileSecretSet).toBe(true);
    const outputs = [
      saved,
      await s.call("settings.get", s.adminActor),
      await s.call("site.get", {}, {}),
      await s.call("site.get", userActor(insertUser(s.ctx)), {}),
    ];
    for (const output of outputs) {
      expect(JSON.stringify(output)).not.toContain(SECRET);
      expect(Object.keys(output)).not.toContain("turnstileSecret");
    }
    const configuration = s.ctx.sqlite
      .prepare<{ value: string }, []>("SELECT value FROM site_settings WHERE key = 'configuration'")
      .get()!.value;
    expect(configuration).not.toContain(SECRET);
    const logged = s.ctx.sqlite
      .prepare<{ details: string | null }, []>("SELECT * FROM moderator_log")
      .all();
    expect(JSON.stringify(logged)).not.toContain(SECRET);
    // The public part is the key and the forms, and only while it is on.
    expect((await s.call("site.get", {}, {})).turnstile).toEqual({
      siteKey: SITE_KEY,
      forms: ["register", "passwordReset", "resendConfirmation"],
    });
    await s.settings({ turnstileEnabled: false });
    expect((await s.call("site.get", {}, {})).turnstile).toBeNull();
  });

  test("changing another setting keeps the secret; only administrators write it", async () => {
    const s = site();
    await s.enable();
    await s.settings({ siteName: "Renamed" });
    expect((await s.call("settings.get", s.adminActor)).turnstileSecretSet).toBe(true);
    const cf = cloudflare({ success: true });
    expect((await s.signUp("Alice", { token: "t" })).status).toBe(200);
    expect(cf.calls[0]!.body.secret).toBe(SECRET);
    const member = userActor(insertUser(s.ctx));
    await expect(s.call("settings.update", member, { turnstileSecret: "x" })).rejects.toThrow();
    await expect(s.call("settings.get", member)).rejects.toThrow();
  });

  test("forms are a set", async () => {
    const s = site();
    const saved = await s.enable({ turnstileForms: ["login", "login", "register"] });
    expect(saved.turnstileForms).toEqual(["login", "register"]);
  });
});

describe("registration", () => {
  test("a missing token is refused before Cloudflare is asked, and no account is made", async () => {
    const s = site();
    await s.enable();
    const cf = cloudflare({ success: true });
    const before = accounts(s);
    const response = await s.signUp("Alice");
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("TURNSTILE_REQUIRED");
    expect((await s.signUp("Alice", { token: "   " })).status).toBe(400);
    expect(cf.calls).toHaveLength(0);
    expect(accounts(s)).toBe(before);
  });

  test("a good token lets the sign-up through and is verified with the secret and the client address", async () => {
    const s = site();
    await s.enable();
    const cf = cloudflare({ success: true });
    const response = await s.signUp("Alice", { token: "good-token", ip: "203.0.113.9" });
    expect(response.status).toBe(200);
    expect(cf.calls).toHaveLength(1);
    const call = cf.calls[0]!;
    expect(call.init.method).toBe("POST");
    expect(call.body).toEqual({ secret: SECRET, response: "good-token", remoteip: "203.0.113.9" });
    expect(call.init.signal).toBeInstanceOf(AbortSignal);
  });

  test("without a client address the request carries no remoteip", async () => {
    const s = site();
    await s.enable();
    const cf = cloudflare({ success: true });
    expect((await s.signUp("Alice", { token: "t", ip: null })).status).toBe(200);
    expect(cf.calls[0]!.body).toEqual({ secret: SECRET, response: "t" });
  });

  test("a refused token is a clear 400 and no account is made", async () => {
    const s = site();
    await s.enable();
    const before = accounts(s);
    for (const code of ["invalid-input-response", "timeout-or-duplicate", "bad-request"]) {
      cloudflare({ success: false, "error-codes": [code] });
      const response = await s.signUp("Alice", { token: "bad" });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { code: string; message: string };
      expect(body.code).toBe("TURNSTILE_FAILED");
      expect(body.message).toContain("security check");
    }
    expect(accounts(s)).toBe(before);
  });

  test("a token longer than Cloudflare allows is refused without asking", async () => {
    const s = site();
    await s.enable();
    const cf = cloudflare({ success: true });
    const response = await s.signUp("Alice", { token: "x".repeat(2049) });
    expect(response.status).toBe(400);
    expect(await codeOf(response)).toBe("TURNSTILE_FAILED");
    expect(cf.calls).toHaveLength(0);
  });

  test("it fails closed: a timeout, an outage, a bad answer or a wrong secret refuse with 503", async () => {
    const s = site();
    await s.enable();
    const before = accounts(s);
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const outages: Verdict[] = [
      new DOMException("The operation timed out.", "TimeoutError"),
      new TypeError("fetch failed"),
      new Response("bad gateway", { status: 502 }),
      new Response("<html>not json</html>", { status: 200 }),
      { success: false, "error-codes": ["internal-error"] },
      { success: false, "error-codes": ["invalid-input-secret"] },
      { success: false, "error-codes": ["missing-input-secret"] },
    ];
    for (const outage of outages) {
      cloudflare(outage);
      const response = await s.signUp("Alice", { token: "t" });
      expect(response.status, String(outage)).toBe(503);
      expect(await codeOf(response)).toBe("TURNSTILE_UNAVAILABLE");
    }
    expect(accounts(s)).toBe(before);
    // Neither the secret nor the token reaches the log.
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('"t"');
    warn.mockRestore();
  });

  test("a client address the adapter could not read is not sent to Cloudflare", async () => {
    const s = site();
    await s.enable();
    const cf = cloudflare({ success: true });
    expect((await s.signUp("Alice", { token: "t", ip: "unknown" })).status).toBe(200);
    expect(cf.calls[0]!.body).toEqual({ secret: SECRET, response: "t" });
    expect((await s.signUp("Bob", { token: "t", ip: "2001:db8::7" })).status).toBe(200);
    expect(cf.calls[1]!.body.remoteip).toBe("2001:db8::7");
  });

  test("a token solved for another form is refused, whichever way the action is wrong", async () => {
    const s = site();
    await s.enable({ turnstileForms: ["register", "login"] });
    cloudflare({ success: true });
    await s.signUp("Alice", { token: "t" });
    for (const action of ["login", "passwordReset", "", undefined]) {
      cloudflare({ success: true, action, hostname: "localhost" });
      const response = await s.signUp(`User${String(action)}`, { token: "t" });
      expect(response.status, String(action)).toBe(400);
      expect(await codeOf(response)).toBe("TURNSTILE_FAILED");
    }
    // The same token on the form it was solved for passes.
    cloudflare({ success: true, action: "login", hostname: "localhost" });
    const credentials = { email: "alice@example.test", password: PASSWORD };
    expect((await s.post("/sign-in/email", credentials, { token: "t" })).status).toBe(200);
  });

  test("a token solved on another host is refused; the site's own hosts pass, in any case", async () => {
    const s = site();
    await s.enable();
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    for (const hostname of ["evil.example", undefined, "localhost.evil.example"]) {
      cloudflare({ success: true, action: "register", hostname });
      const response = await s.signUp("Alice", { token: "secret-token-value" });
      expect(response.status, String(hostname)).toBe(400);
      expect(await codeOf(response)).toBe("TURNSTILE_FAILED");
    }
    // The host that was refused is logged to help the administrator; the token and secret are not.
    expect(JSON.stringify(warn.mock.calls)).toContain("evil.example");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-token-value");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
    warn.mockRestore();
    cloudflare({ success: true, action: "register", hostname: "LocalHost" });
    expect((await s.signUp("Bob", { token: "t" })).status).toBe(200);
  });

  test("the hosts come from the public address, the site address and the trusted origins; with none the host is not compared", async () => {
    const s = site();
    await s.enable();
    const auth = s.ctx.config.auth!;
    Object.assign(auth, {
      baseURL: "https://forum.example.test",
      trustedOrigins: ["https://www.example.test:8443"],
    });
    for (const hostname of ["forum.example.test", "www.example.test"]) {
      cloudflare({ success: true, action: "register", hostname });
      expect((await s.signUp(`User${hostname.length}`, { token: "t" })).status).toBe(200);
    }
    cloudflare({ success: true, action: "register", hostname: "localhost" });
    expect((await s.signUp("Mallory", { token: "t" })).status).toBe(400);
    Object.assign(auth, { baseURL: "", trustedOrigins: [] });
    cloudflare({ success: true, action: "register", hostname: "anywhere.example" });
    expect((await s.signUp("Carol", { token: "t" })).status).toBe(200);
  });

  test("a trusted origin with a wildcard takes its sub-domains, not the bare domain, and www. is not folded", async () => {
    const s = site();
    await s.enable();
    Object.assign(s.ctx.config.auth!, {
      baseURL: "https://example.test",
      trustedOrigins: ["https://*.forum.example.test"],
    });
    for (const [hostname, status] of [
      ["example.test", 200],
      ["a.forum.example.test", 200],
      ["B.Forum.Example.Test", 200],
      ["x.y.forum.example.test", 200],
      ["forum.example.test", 400],
      ["www.example.test", 400],
      ["evilforum.example.test", 400],
      ["a.forum.example.test.evil.example", 400],
    ] as const) {
      cloudflare({ success: true, action: "register", hostname });
      const response = await s.signUp(`User${Math.random().toString(36).slice(2, 8)}`, {
        token: "t",
      });
      expect(response.status, hostname).toBe(status);
    }
  });

  test("the secret is read with a prepared statement", async () => {
    const s = site();
    await s.enable();
    cloudflare({ success: true });
    await s.signUp("Alice", { token: "t" });
    expect(s.ctx.statements.has("settings.turnstileSecret")).toBe(true);
  });

  test("the deadline is short", () => {
    expect(SITEVERIFY_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
  });

  test("a secret that vanished while it was on refuses instead of letting everyone in", async () => {
    const s = site();
    await s.enable();
    s.ctx.sqlite.run("DELETE FROM site_settings WHERE key = 'turnstile_secret'");
    const cf = cloudflare({ success: true });
    const response = await s.signUp("Alice", { token: "t" });
    expect(response.status).toBe(503);
    expect(cf.calls).toHaveLength(0);
  });
});

describe("which forms", () => {
  test("only the forms in the list are guarded", async () => {
    const s = site();
    await s.signUp("Alice");
    await s.enable({ turnstileForms: ["login"] });
    const cf = cloudflare({ success: true });
    // Registration is not listed: no token needed, nothing sent to Cloudflare.
    expect((await s.signUp("Bob")).status).toBe(200);
    expect(cf.calls).toHaveLength(0);
    const credentials = { email: "alice@example.test", password: PASSWORD };
    const refused = await s.post("/sign-in/email", credentials);
    expect(refused.status).toBe(400);
    expect(await codeOf(refused)).toBe("TURNSTILE_REQUIRED");
    expect((await s.post("/sign-in/email", credentials, { token: "t" })).status).toBe(200);
    expect(cf.calls).toHaveLength(1);
  });

  test("sign-in by username is guarded like sign-in by email, and a refusal costs no password guess", async () => {
    const s = site();
    await s.signUp("Alice");
    await s.enable({ turnstileForms: ["login"] });
    const cf = cloudflare({ success: true });
    const ip = "198.51.100.200";
    const body = { username: "Alice", password: "Wrong-password-1" };
    expect((await s.post("/sign-in/username", body, { ip })).status).toBe(400);
    expect((await s.post("/sign-in/username", body, { ip, token: "t" })).status).toBe(401);
    expect(cf.calls).toHaveLength(1);
  });

  test("password reset and resend confirmation are guarded when the site sends mail", async () => {
    const s = site({ mail: true });
    await s.enable({ turnstileForms: ["passwordReset", "resendConfirmation"] });
    const cf = cloudflare({ success: true });
    const reset = { email: "nobody@example.test", redirectTo: `${ORIGIN}/reset-password` };
    const resend = { email: "nobody@example.test", callbackURL: `${ORIGIN}/verify-email` };
    expect(await codeOf(await s.post("/request-password-reset", reset))).toBe("TURNSTILE_REQUIRED");
    expect(await codeOf(await s.post("/send-verification-email", resend))).toBe(
      "TURNSTILE_REQUIRED",
    );
    expect(cf.calls).toHaveLength(0);
    expect((await s.post("/request-password-reset", reset, { token: "t" })).status).toBe(200);
    expect((await s.post("/send-verification-email", resend, { token: "t" })).status).toBe(200);
    expect(cf.calls).toHaveLength(2);
  });

  test("without account mail those two forms send nothing, so there is nothing to guard", async () => {
    const s = site();
    await s.enable({ turnstileForms: ["passwordReset", "resendConfirmation"] });
    const cf = cloudflare({ success: true });
    const reset = await s.post("/request-password-reset", {
      email: "nobody@example.test",
      redirectTo: `${ORIGIN}/reset-password`,
    });
    expect(await codeOf(reset)).toBe("RESET_PASSWORD_DISABLED");
    const resend = await s.post("/send-verification-email", { email: "nobody@example.test" });
    expect(await codeOf(resend)).toBe("VERIFICATION_EMAIL_NOT_ENABLED");
    expect(cf.calls).toHaveLength(0);
  });
});

describe("members never see it", () => {
  test("a signed-in member asking for their own confirmation mail needs no token", async () => {
    const s = site({ mail: true });
    const alice = await s.signUp("Alice");
    const cookie = cookieOf(alice);
    await s.enable();
    const cf = cloudflare({ success: true });
    const own = { email: "alice@example.test", callbackURL: `${ORIGIN}/verify-email` };
    expect((await s.post("/send-verification-email", own, { cookie })).status).toBe(200);
    expect(cf.calls).toHaveLength(0);
    // The same request from a guest is guarded.
    expect(await codeOf(await s.post("/send-verification-email", own))).toBe("TURNSTILE_REQUIRED");
  });

  test("other account actions of a member, and every operation, ask for no token", async () => {
    const s = site();
    const alice = await s.signUp("Alice");
    const cookie = cookieOf(alice);
    await s.enable();
    const cf = cloudflare({ success: true });
    const changed = await s.post(
      "/change-password",
      { currentPassword: PASSWORD, newPassword: "Another-secret-9" },
      { cookie },
    );
    expect(changed.status).toBe(200);
    const member = userActor(insertUser(s.ctx));
    await s.call("profiles.update", member, { about: "hello" });
    await s.call("auth.me", member);
    expect(cf.calls).toHaveLength(0);
  });

  test("a call made inside the server has no visitor to ask: the administrator's reset link goes out", async () => {
    const s = site({ mail: true });
    await s.signUp("Alice");
    await s.enable({ turnstileForms: ["passwordReset", "register", "login"] });
    const cf = cloudflare({ success: true });
    const auth = getAuth(s.ctx);
    await auth.api.requestPasswordReset({
      body: { email: "alice@example.test", redirectTo: `${ORIGIN}/reset-password` },
    });
    expect(cf.calls).toHaveLength(0);
  });

  test("holding a session does not excuse a sign-up", async () => {
    const s = site();
    const alice = await s.signUp("Alice");
    await s.enable();
    cloudflare({ success: true });
    const again = await s.signUp("Mallory", { cookie: cookieOf(alice) });
    expect(again.status).toBe(400);
    expect(await codeOf(again)).toBe("TURNSTILE_REQUIRED");
  });
});
