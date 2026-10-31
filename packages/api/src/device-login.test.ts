import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  type Ctx,
  closeContext,
  ensureAdmin,
  execute,
  getOperation,
  registerAccountEmailJobs,
  registerEmailJobs,
} from "@sermo/core";
import { createTestContext, insertNode, userActor } from "@sermo/core/testing";
import { getAuth } from "../../core/src/modules/auth";
import { runDueJobs } from "../../core/src/modules/jobs/queue";
import { registerModerationJobs } from "../../core/src/modules/moderation";
import { createApp } from "./app";
import { siteLanguage } from "./site-language.test";

/*
 * The device login of a terminal client (sermo-cli), through the HTTP app: the client asks for a
 * code, the member approves it in the browser, the client polls for its token and calls the REST
 * API with it as a Bearer token. The token is a member-only credential.
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "Password123!";
const CLI_AGENT = "sermo-cli/1.2.0 (linux/amd64; work-laptop)";
const GRANT = "urn:ietf:params:oauth:grant-type:device_code";

const contexts: Ctx[] = [];
afterEach(() => {
  setSystemTime();
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

// Better Auth keeps its request counts per address across contexts, so addresses are not reused.
let address = 1;

type Json = Record<string, unknown>;

async function world(options: { mail?: boolean } = {}) {
  const ctx = createTestContext();
  contexts.push(ctx);
  siteLanguage(ctx, "en");
  const capture = options.mail
    ? (() => {
        const sent = registerEmailJobs(
          ctx,
          { driver: "capture", sender: "forum@example.test" },
          { defaults: {}, securityTypes: new Set() },
        )!;
        registerAccountEmailJobs(ctx);
        return sent;
      })()
    : null;
  const app = createApp(ctx, { trustedProxyHeader: null });
  const ip = `198.51.100.${address++}`;
  const env = { requestIP: () => ({ address: ip, family: "IPv4" as const, port: 1 }) };
  const request = (path: string, init: RequestInit = {}) => app.request(path, init, env);
  const json = (method: string, path: string, body: unknown, headers: Json = {}) =>
    request(path, {
      method,
      headers: { "content-type": "application/json", ...(headers as Record<string, string>) },
      body: JSON.stringify(body),
    });
  const browser = (cookie: string) => ({ cookie, origin: ORIGIN });
  const cookieOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .filter((value) => !/max-age=0/i.test(value))
      .map((value) => value.split(";")[0])
      .join("; ");
  const register = async (username: string) => {
    const made = await getAuth(ctx).api.signUpEmail({
      body: {
        name: username,
        username,
        email: `${username.toLowerCase()}@example.test`,
        password: PASSWORD,
      },
    });
    return Number(made.user.id);
  };
  const signIn = async (username: string) => {
    const response = await json(
      "POST",
      "/api/auth/sign-in/username",
      { username, password: PASSWORD },
      { origin: ORIGIN },
    );
    expect(response.status).toBe(200);
    return cookieOf(response);
  };
  const askCode = async (body: Json = { client_id: "sermo-cli" }) => {
    const response = await json("POST", "/api/auth/device/code", body, { "user-agent": CLI_AGENT });
    return { status: response.status, body: (await response.json()) as Json };
  };
  const verify = async (userCode: string, cookie: string) => {
    const response = await request(`/api/auth/device?user_code=${encodeURIComponent(userCode)}`, {
      headers: { cookie },
    });
    return { status: response.status, body: (await response.json()) as Json };
  };
  const decide = async (choice: "approve" | "deny", userCode: string, cookie: string) => {
    const response = await json(
      "POST",
      `/api/auth/device/${choice}`,
      { userCode },
      browser(cookie),
    );
    return { status: response.status, body: (await response.json()) as Json };
  };
  const poll = async (deviceCode: string, clientId = "sermo-cli") => {
    const response = await json(
      "POST",
      "/api/auth/device/token",
      { grant_type: GRANT, device_code: deviceCode, client_id: clientId },
      { "user-agent": CLI_AGENT },
    );
    return { response, status: response.status, body: (await response.json()) as Json };
  };
  /** A device login approved by the signed-in member: its token. */
  const login = async (cookie: string) => {
    const code = await askCode();
    expect(code.status).toBe(200);
    expect((await verify(String(code.body.user_code), cookie)).status).toBe(200);
    expect((await decide("approve", String(code.body.user_code), cookie)).status).toBe(200);
    const token = await poll(String(code.body.device_code));
    expect(token.status).toBe(200);
    return String(token.body.access_token);
  };
  const bearer = (token: string, path: string, init: RequestInit = {}) =>
    request(path, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        "user-agent": CLI_AGENT,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });
  const terminalSessions = (userId: number) =>
    ctx.sqlite
      .prepare<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM auth_session WHERE user_id = ?1 AND terminal_client IS NOT NULL",
      )
      .get(userId)!.n;
  return {
    ctx,
    capture,
    request,
    json,
    browser,
    cookieOf,
    register,
    signIn,
    askCode,
    verify,
    decide,
    poll,
    login,
    bearer,
    terminalSessions,
  };
}

describe("the device flow", () => {
  test("a code is given only to sermo-cli, with the verification page of the site", async () => {
    const w = await world();
    const code = await w.askCode();
    expect(code.status).toBe(200);
    expect(code.body).toMatchObject({
      verification_uri: `${ORIGIN}/device`,
      expires_in: 1800,
      interval: 5,
    });
    expect(code.body.verification_uri_complete).toBe(
      `${ORIGIN}/device?user_code=${code.body.user_code}`,
    );
    expect(String(code.body.user_code)).toMatch(/^[A-Z0-9]{8}$/);
    expect(String(code.body.device_code).length).toBeGreaterThanOrEqual(40);
  });

  test("an unknown client id is refused", async () => {
    const w = await world();
    const code = await w.askCode({ client_id: "other-cli" });
    expect(code.status).toBe(400);
    expect(code.body.error).toBe("invalid_client");
  });

  test("a client cannot name the member a code is for", async () => {
    const w = await world();
    const member = await w.register("Ada");
    const code = await w.askCode({ client_id: "sermo-cli", user_id: String(member) });
    expect(code.status).toBe(400);
    expect(code.body.error).toBe("invalid_request");
  });

  test("a form-encoded request works on both endpoints, as RFC 8628 clients send it", async () => {
    const w = await world();
    await w.register("Ada");
    const cookie = await w.signIn("Ada");
    const form = (path: string, values: Record<string, string>) =>
      w.request(path, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(values).toString(),
      });
    const code = (await (
      await form("/api/auth/device/code", { client_id: "sermo-cli" })
    ).json()) as Json;
    await w.verify(String(code.user_code), cookie);
    await w.decide("approve", String(code.user_code), cookie);
    const token = await form("/api/auth/device/token", {
      grant_type: GRANT,
      device_code: String(code.device_code),
      client_id: "sermo-cli",
    });
    expect(token.status).toBe(200);
    expect(((await token.json()) as Json).token_type).toBe("Bearer");
  });

  test("approve: the client gets a Bearer token of the member, and no browser cookie", async () => {
    const w = await world();
    const member = await w.register("Ada");
    const cookie = await w.signIn("Ada");
    const code = await w.askCode();
    const userCode = String(code.body.user_code);
    const pending = await w.poll(String(code.body.device_code));
    expect(pending.status).toBe(400);
    expect(pending.body.error).toBe("authorization_pending");
    const seen = await w.verify(userCode, cookie);
    expect(seen.body).toMatchObject({ status: "pending", client_id: "sermo-cli" });
    expect((await w.decide("approve", userCode, cookie)).body).toEqual({ success: true });
    setSystemTime(new Date(Date.now() + 6_000));
    const token = await w.poll(String(code.body.device_code));
    expect(token.status).toBe(200);
    expect(token.body.token_type).toBe("Bearer");
    // A fixed lifetime of 90 days.
    expect(Number(token.body.expires_in)).toBeGreaterThan(90 * 86_400 - 60);
    expect(Number(token.body.expires_in)).toBeLessThanOrEqual(90 * 86_400);
    expect(token.response.headers.getSetCookie()).toEqual([]);
    const me = await w.bearer(String(token.body.access_token), "/api/v1/me");
    expect(me.status).toBe(200);
    expect(((await me.json()) as { user: { id: number } }).user.id).toBe(member);
    // The code is spent.
    setSystemTime(new Date(Date.now() + 12_000));
    expect((await w.poll(String(code.body.device_code))).body.error).toBe("invalid_grant");
  });

  test("the token is not a browser session: signed as a cookie it is nothing without the secret", async () => {
    const w = await world();
    await w.register("Ada");
    const token = await w.login(await w.signIn("Ada"));
    const asCookie = await w.request("/api/v1/me", {
      headers: { cookie: `sermo.session_token=${token}` },
    });
    expect(asCookie.status).toBe(401);
  });

  test("deny: the client is told access_denied and gets no token", async () => {
    const w = await world();
    await w.register("Ada");
    const cookie = await w.signIn("Ada");
    const code = await w.askCode();
    await w.verify(String(code.body.user_code), cookie);
    expect((await w.decide("deny", String(code.body.user_code), cookie)).status).toBe(200);
    const token = await w.poll(String(code.body.device_code));
    expect(token.status).toBe(400);
    expect(token.body.error).toBe("access_denied");
    expect(token.body.access_token).toBeUndefined();
  });

  test("an expired code can be neither approved nor exchanged", async () => {
    const w = await world();
    await w.register("Ada");
    const cookie = await w.signIn("Ada");
    const code = await w.askCode();
    await w.verify(String(code.body.user_code), cookie);
    setSystemTime(new Date(Date.now() + 31 * 60_000));
    const approve = await w.decide("approve", String(code.body.user_code), cookie);
    expect(approve.status).toBe(400);
    expect(approve.body.error).toBe("expired_token");
    const token = await w.poll(String(code.body.device_code));
    expect(token.status).toBe(400);
    expect(token.body.error).toBe("expired_token");
  });

  test("polling faster than the interval is answered slow_down", async () => {
    const w = await world();
    const code = await w.askCode();
    expect((await w.poll(String(code.body.device_code))).body.error).toBe("authorization_pending");
    const fast = await w.poll(String(code.body.device_code));
    expect(fast.status).toBe(400);
    expect(fast.body.error).toBe("slow_down");
  });

  test("a token is not given to another client id than the one the code was made for", async () => {
    const w = await world();
    await w.register("Ada");
    const cookie = await w.signIn("Ada");
    const code = await w.askCode();
    await w.verify(String(code.body.user_code), cookie);
    await w.decide("approve", String(code.body.user_code), cookie);
    const token = await w.poll(String(code.body.device_code), "other-cli");
    expect(token.status).toBe(400);
    expect(token.body.error).toBe("invalid_grant");
  });

  test("another member cannot approve a code the first member opened", async () => {
    const w = await world();
    await w.register("Ada");
    await w.register("Bob");
    const ada = await w.signIn("Ada");
    const bob = await w.signIn("Bob");
    const code = await w.askCode();
    await w.verify(String(code.body.user_code), ada);
    const seen = await w.verify(String(code.body.user_code), bob);
    expect(seen.body.client_id).toBeUndefined();
    expect((await w.decide("approve", String(code.body.user_code), bob)).status).toBe(403);
  });

  test("members who share one address can each open the page more than five times", async () => {
    const w = await world();
    await w.register("Ada");
    const cookie = await w.signIn("Ada");
    const code = await w.askCode();
    for (let view = 0; view < 8; view++)
      expect((await w.verify(String(code.body.user_code), cookie)).status).toBe(200);
  });

  test("approving needs a signed-in member", async () => {
    const w = await world();
    const code = await w.askCode();
    const approve = await w.json(
      "POST",
      "/api/auth/device/approve",
      { userCode: code.body.user_code },
      { origin: ORIGIN },
    );
    expect(approve.status).toBe(401);
  });
});

describe("the token as a credential", () => {
  test("an unknown or malformed Bearer token is refused, never read as a guest", async () => {
    const w = await world();
    expect((await w.bearer("not-a-token", "/api/v1/me")).status).toBe(401);
    expect((await w.request("/api/v1/me", { headers: { authorization: "Bearer" } })).status).toBe(
      401,
    );
  });

  test("an expired token is refused", async () => {
    const w = await world();
    await w.register("Ada");
    const token = await w.login(await w.signIn("Ada"));
    setSystemTime(new Date(Date.now() + 91 * 86_400_000));
    expect((await w.bearer(token, "/api/v1/me")).status).toBe(401);
  });

  test("a browser session token used as a Bearer token is refused", async () => {
    const w = await world();
    await w.register("Ada");
    await w.signIn("Ada");
    const browserToken = w.ctx.sqlite
      .prepare<{ token: string }, []>("SELECT token FROM auth_session ORDER BY id DESC LIMIT 1")
      .get()!.token;
    expect((await w.bearer(browserToken, "/api/v1/me")).status).toBe(401);
  });

  test("a staff member's token is refused on staff, moderation and admin operations", async () => {
    const w = await world();
    const node = insertNode(w.ctx, {});
    const { userId: admin } = await ensureAdmin(w.ctx, {
      username: "Boss",
      email: "boss@example.test",
      password: PASSWORD,
    });
    const author = await w.register("Ada");
    await w.register("Bob");
    const thread = (await execute(
      w.ctx,
      getOperation("threads.create"),
      userActor({ id: author, groupId: 2 }),
      {
        nodeId: node.id,
        title: "A thread",
        body: "Words of Ada",
      },
    )) as { thread: { id: number }; post: { id: number } };
    const cookie = await w.signIn("Boss");
    // The same requests from the browser session pass, so the refusals below are the token's.
    const browserList = await w.request("/api/v1/admin/users", { headers: { cookie } });
    expect(browserList.status).toBe(200);
    const token = await w.login(cookie);
    // A plain member's device login, for the answer a member without staff powers gets.
    const memberToken = await w.login(await w.signIn("Bob"));
    const refused: [string, string, unknown?][] = [
      ["GET", "/api/v1/admin/users"],
      ["GET", `/api/v1/admin/users/${author}`],
      ["PATCH", "/api/v1/settings", { siteName: "Taken" }],
      ["GET", "/api/v1/moderation/log"],
      [
        "PUT",
        "/api/v1/moderation/state",
        { target: { type: "post", id: thread.post.id }, state: "deleted" },
      ],
      ["POST", `/api/v1/users/${author}/bans`, { reason: "No", expiresAt: null }],
      ["PATCH", `/api/v1/posts/${thread.post.id}`, { body: "Edited by staff" }],
      ["PUT", `/api/v1/users/${author}/super-admin`, { superAdmin: true, actorPassword: PASSWORD }],
    ];
    const send = (as: string, method: string, path: string, body: unknown) =>
      w.bearer(as, path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    for (const [method, path, body] of refused) {
      const staff = (await send(token, method, path, body)).status;
      const member = (await send(memberToken, method, path, body)).status;
      // 403, or the 404 the operation gives every member without the power (a moderation write
      // does not tell that the content exists): exactly what a plain member gets.
      expect({ path, staff }).toEqual({ path, staff: member });
      expect([403, 404]).toContain(staff);
    }
    // Nothing changed.
    const post = (await (
      await w.request(`/api/v1/posts/${thread.post.id}`, { headers: { cookie } })
    ).json()) as { state: string; bodySource?: string };
    expect(post.state).toBe("visible");
    const me = (await (await w.bearer(token, "/api/v1/me")).json()) as {
      user: { id: number };
      permissions: { isAdmin: boolean; isModerator: boolean };
      staff: { panel: boolean };
      resolvedPermissions: Record<string, unknown>;
    };
    expect(me.user.id).toBe(admin);
    expect(me.permissions).toMatchObject({ isAdmin: false, isModerator: false });
    expect(me.staff.panel).toBe(false);
    expect(me.resolvedPermissions["admin.settings"]).toBe(false);
    // The member's own powers stay.
    expect(me.resolvedPermissions["profile.editOwn"]).toBe(true);
  });

  test("the token is refused where an API key is refused", async () => {
    const w = await world();
    await w.register("Ada");
    const cookie = await w.signIn("Ada");
    const token = await w.login(cookie);
    const auth = (path: string, body: unknown) =>
      w.bearer(token, `/api/auth${path}`, { method: "POST", body: JSON.stringify(body) });
    expect(
      (await auth("/change-password", { currentPassword: PASSWORD, newPassword: "Another123!" }))
        .status,
    ).toBe(401);
    expect((await auth("/api-key/create", { password: PASSWORD })).status).toBe(401);
    expect((await auth("/revoke-other-sessions", {})).status).toBe(401);
    expect((await w.bearer(token, "/api/auth/list-sessions")).status).toBe(401);
    for (const [method, path, body] of [
      ["GET", "/api/v1/me/session-devices"],
      ["GET", "/api/v1/me/sign-in-history"],
      ["POST", "/api/v1/me/verify-password", { password: PASSWORD }],
      ["POST", "/api/v1/me/delete-account", { password: PASSWORD }],
    ] as [string, string, unknown?][]) {
      const response = await w.bearer(token, path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      expect({ path, status: response.status }).toEqual({ path, status: 403 });
    }
  });

  test("requests are counted per member, together with the member's browser session", async () => {
    const ctx = createTestContext();
    contexts.push(ctx);
    siteLanguage(ctx, "en");
    const app = createApp(ctx, { trustedProxyHeader: null, rateLimits: { read: 2 } });
    const env = {
      requestIP: () => ({ address: `198.51.100.${address++}`, family: "IPv4" as const, port: 1 }),
    };
    await getAuth(ctx).api.signUpEmail({
      body: { name: "Ada", username: "Ada", email: "ada@example.test", password: PASSWORD },
    });
    const signedIn = await app.request(
      "/api/auth/sign-in/username",
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: ORIGIN },
        body: JSON.stringify({ username: "Ada", password: PASSWORD }),
      },
      env,
    );
    const cookie = signedIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    const call = async (path: string, init: RequestInit) => app.request(path, init, env);
    const code = (await (
      await call("/api/auth/device/code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_id: "sermo-cli" }),
      })
    ).json()) as Json;
    await call(`/api/auth/device?user_code=${code.user_code}`, { headers: { cookie } });
    await call("/api/auth/device/approve", {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: ORIGIN },
      body: JSON.stringify({ userCode: code.user_code }),
    });
    const token = (
      (await (
        await call("/api/auth/device/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            grant_type: GRANT,
            device_code: code.device_code,
            client_id: "sermo-cli",
          }),
        })
      ).json()) as Json
    ).access_token as string;
    expect((await call("/api/v1/me", { headers: { cookie } })).status).toBe(200);
    expect(
      (await call("/api/v1/me", { headers: { authorization: `Bearer ${token}` } })).status,
    ).toBe(200);
    expect(
      (await call("/api/v1/me", { headers: { authorization: `Bearer ${token}` } })).status,
    ).toBe(429);
  });
});

describe("ending a device login", () => {
  test("the client signs itself out; the browser session stays", async () => {
    const w = await world();
    const member = await w.register("Ada");
    const cookie = await w.signIn("Ada");
    const token = await w.login(cookie);
    const other = await w.login(cookie);
    const out = await w.bearer(token, "/api/v1/me/device-login/sign-out", {
      method: "POST",
      body: "{}",
    });
    expect(out.status).toBe(200);
    expect(await out.json()).toEqual({ ok: true });
    expect((await w.bearer(token, "/api/v1/me")).status).toBe(401);
    // Only the calling login ends.
    expect((await w.bearer(other, "/api/v1/me")).status).toBe(200);
    expect(w.terminalSessions(member)).toBe(1);
    expect((await w.request("/api/v1/me", { headers: { cookie } })).status).toBe(200);
  });

  test("only a device login may use the sign-out operation", async () => {
    const w = await world();
    await w.register("Ada");
    const cookie = await w.signIn("Ada");
    const out = await w.json("POST", "/api/v1/me/device-login/sign-out", {}, w.browser(cookie));
    expect(out.status).toBe(403);
    expect((await w.request("/api/v1/me", { headers: { cookie } })).status).toBe(200);
    expect((await w.request("/api/v1/me/device-login/sign-out", { method: "POST" })).status).toBe(
      401,
    );
  });

  test("a password change ends the device logins, even when the other sessions are kept", async () => {
    const w = await world();
    const member = await w.register("Ada");
    const cookie = await w.signIn("Ada");
    const token = await w.login(cookie);
    const changed = await w.json(
      "POST",
      "/api/auth/change-password",
      { currentPassword: PASSWORD, newPassword: "Another123!", revokeOtherSessions: false },
      w.browser(cookie),
    );
    expect(changed.status).toBe(200);
    expect((await w.bearer(token, "/api/v1/me")).status).toBe(401);
    expect(w.terminalSessions(member)).toBe(0);
    expect((await w.request("/api/v1/me", { headers: { cookie } })).status).toBe(200);
  });

  test("signing out everywhere ends the device logins", async () => {
    const w = await world();
    await w.register("Ada");
    const cookie = await w.signIn("Ada");
    const token = await w.login(cookie);
    const out = await w.json("POST", "/api/auth/revoke-other-sessions", {}, w.browser(cookie));
    expect(out.status).toBe(200);
    expect((await w.bearer(token, "/api/v1/me")).status).toBe(401);
  });

  test("the member ends one device login from the browser by its session", async () => {
    const w = await world();
    await w.register("Ada");
    const cookie = await w.signIn("Ada");
    const token = await w.login(cookie);
    const out = await w.json("POST", "/api/auth/revoke-session", { token }, w.browser(cookie));
    expect(out.status).toBe(200);
    expect((await w.bearer(token, "/api/v1/me")).status).toBe(401);
  });

  test("a ban ends the device logins", async () => {
    const w = await world();
    const { userId: admin } = await ensureAdmin(w.ctx, {
      username: "Boss",
      email: "boss@example.test",
      password: PASSWORD,
    });
    const member = await w.register("Ada");
    const token = await w.login(await w.signIn("Ada"));
    await execute(w.ctx, getOperation("bans.create"), userActor({ id: admin, groupId: 4 }), {
      userId: member,
      reason: "Rules",
      expiresAt: null,
    });
    // Refused at once, by the ban itself; the job that ends the member's credentials deletes it.
    expect((await w.bearer(token, "/api/v1/me")).status).toBe(403);
    registerModerationJobs(w.ctx);
    await runDueJobs(w.ctx);
    expect(w.terminalSessions(member)).toBe(0);
    expect((await w.bearer(token, "/api/v1/me")).status).toBe(401);
  });
});

describe("the member's view of a device login", () => {
  test("the security page lists it by the client's name and host", async () => {
    const w = await world();
    await w.register("Ada");
    const cookie = await w.signIn("Ada");
    await w.login(cookie);
    const listed = (await (
      await w.request("/api/v1/me/session-devices", { headers: { cookie } })
    ).json()) as { items: { sessionId: number; terminalClient?: string }[] };
    // The newest first: the device login, then the browser sessions.
    expect(listed.items.map((item) => item.terminalClient)).toEqual([
      "sermo-cli · work-laptop",
      undefined,
      undefined,
    ]);
  });

  test("a security notice is mailed when a device login is approved", async () => {
    const w = await world({ mail: true });
    const member = await w.register("Ada");
    w.ctx.sqlite.prepare("UPDATE auth_user SET email_verified = 1 WHERE id = ?1").run(member);
    w.ctx.sqlite.prepare("UPDATE users SET group_id = 2 WHERE id = ?1").run(member);
    const cookie = await w.signIn("Ada");
    await runDueJobs(w.ctx);
    w.capture!.messages.length = 0;
    await w.login(cookie);
    await runDueJobs(w.ctx);
    const notices = w.capture!.messages.filter((message) => message.to === "ada@example.test");
    expect(notices.map((message) => message.subject)).toEqual([
      "A terminal client signed in to your Sermo account",
    ]);
    expect(notices[0]!.text).toContain("sermo-cli · work-laptop");
    expect(notices[0]!.text).toContain(`${ORIGIN}/account/security#sessions`);
  });
});
