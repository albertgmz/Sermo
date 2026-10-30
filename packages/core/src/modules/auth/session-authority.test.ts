import { expect, test } from "bun:test";
import { createTestContext } from "@sermo/core/testing";
import { registerEmailJobs } from "../email";
import { registerAccountEmailJobs } from "../email/account";
import { runDueJobs } from "../jobs/queue";
import {
  DISABLED_PATHS,
  getAuth,
  resolveActor,
  revokeUserCredentials,
  SESSIONLESS_PATHS,
} from "./index";

const ORIGIN = "http://localhost:3000";
let clientNumber = 0;

// Endpoints that never read a session and so proceed past a dead session cookie. Deliberately
// spelled out here: an endpoint added to the app's list must be added (and justified) here too,
// and any endpoint missing from both answers a dead cookie with 401.
const SESSIONLESS = [
  "/sign-in/email",
  "/sign-in/username",
  "/sign-up/email",
  "/request-password-reset",
  "/reset-password",
  "/reset-password/:token",
  "/verify-email",
  // Provider sign-ins: neither handler reads a session (a member's link travels in the OAuth
  // state).
  "/sign-in/social",
  "/callback/:id",
];

type Setup = Awaited<ReturnType<typeof setup>>;

function endpointsOf(auth: Setup["auth"], sessionless: boolean) {
  return Object.values(auth.api).filter(
    (endpoint) =>
      endpoint.path &&
      endpoint.path !== "/get-session" &&
      !DISABLED_PATHS.includes(endpoint.path) &&
      SESSIONLESS.includes(endpoint.path) === sessionless,
  );
}

function methodsOf(endpoint: ReturnType<typeof endpointsOf>[number]) {
  return Array.isArray(endpoint.options.method)
    ? endpoint.options.method
    : [endpoint.options.method];
}

const concrete = (path: string) => path.replace(":id", "unknown").replace(":token", "unknown");

// A request that passes validation and is then refused by the handler itself, for each
// session-less endpoint. (A request that fails validation never reaches the after hooks.)
const REFUSED: Record<string, { url: string; method: string; body?: unknown }> = {
  "/sign-in/email": {
    url: "/sign-in/email",
    method: "POST",
    body: { email: "nobody@example.test", password: "Password123!" },
  },
  "/sign-in/username": {
    url: "/sign-in/username",
    method: "POST",
    body: { username: "nobody", password: "Password123!" },
  },
  "/sign-up/email": {
    url: "/sign-up/email",
    method: "POST",
    body: {
      name: "Dup",
      username: "Dup",
      email: "cached@example.test",
      password: "Password123!",
    },
  },
  "/request-password-reset": {
    url: "/request-password-reset",
    method: "POST",
    body: { email: "nobody@example.test", redirectTo: `${ORIGIN}/reset` },
  },
  "/reset-password": {
    url: "/reset-password",
    method: "POST",
    body: { newPassword: "Password123!", token: "unknown" },
  },
  "/reset-password/:token": {
    url: `/reset-password/unknown?callbackURL=${encodeURIComponent(`${ORIGIN}/reset`)}`,
    method: "GET",
  },
  "/verify-email": { url: "/verify-email?token=unknown", method: "GET" },
  "/sign-in/social": { url: "/sign-in/social", method: "POST", body: { provider: "google" } },
  "/callback/:id": { url: "/callback/unknown?code=unknown&state=unknown", method: "GET" },
};

function wellFormed(request: Setup["request"], path: string, cookie: string | string[]) {
  const shape = REFUSED[path]!;
  return request(shape.url, shape.method, shape.body, cookie);
}

async function codeOf(response: Response) {
  const text = await response.text();
  return text ? (JSON.parse(text) as { code?: string }).code : undefined;
}

const isClearing = (value: string) => /^[^=]+=;.*Max-Age=0/i.test(value);

async function setup(prefix = "") {
  const ctx = createTestContext();
  const auth = getAuth(ctx);
  const context = await auth.$context;
  // Exercise the parser with each configured name, including deployments using host cookies.
  context.authCookies.sessionToken.name = `${prefix}sermo.session_token`;
  context.authCookies.sessionData.name = `${prefix}sermo.session_data`;
  const ip = `203.0.113.${++clientNumber}`;
  const request = (path: string, method: string, body: unknown, cookie: string | string[] = "") => {
    const headers = new Headers({
      origin: ORIGIN,
      "content-type": "application/json",
      "x-sermo-client-ip": ip,
    });
    for (const value of typeof cookie === "string" ? [cookie] : cookie)
      if (value) headers.append("Cookie", value);
    return auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method,
        headers,
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      }),
    );
  };
  const response = await request("/sign-up/email", "POST", {
    name: "Cached",
    username: "Cached",
    email: "cached@example.test",
    password: "Password123!",
  });
  expect(response.status).toBe(200);
  const userId = Number(((await response.json()) as { user: { id: string } }).user.id);
  const cookies = response.headers.getSetCookie().map((value) => value.split(";")[0]!);
  const token = cookies.find((value) => value.startsWith(context.authCookies.sessionToken.name))!;
  const data = cookies.find((value) =>
    value.startsWith(`${context.authCookies.sessionData.name}=`),
  )!;
  expect(token).toBeDefined();
  expect(data).toBeDefined();
  return { ctx, auth, request, userId, token, data, cookie: cookies.join("; ") };
}

const variants: Record<string, (token: string, data: string) => string | string[]> = {
  plain: (token, data) => `${token}; ${data}`,
  space: (token, data) => `${token}; ${data.replace("=", " =")}`,
  tabs: (token, data) => `${token.replace("=", "\t=\t")}; \t${data.replace("=", "\t=\t")}`,
  quoted: (token, data) =>
    `${token}; ${data.slice(0, data.indexOf("="))} = "${data.slice(data.indexOf("=") + 1)}"`,
  chunks: (token, data) => {
    const name = data.slice(0, data.indexOf("="));
    const value = data.slice(data.indexOf("=") + 1);
    const half = Math.floor(value.length / 2);
    return `${token}; ${name}.1=${value.slice(half)}; ${name}.0=${value.slice(0, half)}`;
  },
  spacedChunks: (token, data) => {
    const name = data.slice(0, data.indexOf("="));
    const value = data.slice(data.indexOf("=") + 1);
    const half = Math.floor(value.length / 2);
    return `${token}; ${name}.1 =${value.slice(half)}; ${name}.0 =${value.slice(0, half)}`;
  },
  duplicateCache: (token, data) => `${token}; ${data.replace("=", " =")}; ${data}`,
  duplicateToken: (token, data) => `${token}; ${token}; ${data.replace("=", " =")}`,
  multipleHeaders: (token, data) => [`${token};`, data.replace("=", " =")],
  casing: (token, data) => `${token}; ${data.replace("sermo.session_data", "SERMO.SESSION_DATA")}`,
  foreignPrefixes: (token, data) =>
    `${token}; __Host-${data}; __Secure-${data}; ${data.replace("=", " =")}`,
};

for (const prefix of ["", "__Secure-", "__Host-"])
  for (const [name, format] of Object.entries(variants))
    test(`revoked session row blocks update-user with ${prefix || "plain"} ${name} cookies`, async () => {
      const { ctx, request, userId, token, data } = await setup(prefix);
      const cookie = format(token, data);
      // Establish that the request authenticates, so a later 401 cannot hide a malformed test.
      expect((await request("/update-user", "POST", { name: "Live" }, cookie)).status).toBe(200);
      await revokeUserCredentials(ctx, userId);
      const response = await request("/update-user", "POST", { name: "Revoked" }, cookie);
      expect(response.status).toBe(401);
      expect(
        response.headers.getSetCookie().some((value) => /session_data(?:\.\d+)?=[^;]/.test(value)),
      ).toBe(false);
      expect(
        ctx.sqlite
          .prepare<{ name: string }, [number]>("SELECT name FROM auth_user WHERE id = ?1")
          .get(userId)?.name,
      ).toBe("Live");
    });

for (const state of ["revoked", "expired"])
  test(`${state} session cannot mint a non-expiring API key through a cached cookie`, async () => {
    const { ctx, auth, request, userId, token, data, cookie } = await setup();
    const live = await request(
      "/api-key/create",
      "POST",
      { name: "live", password: "Password123!" },
      cookie,
    );
    expect(live.status).toBe(200);
    const key = (await live.json()) as { key: string; expiresAt: null };
    expect(key.expiresAt).toBeNull();
    expect(
      (await resolveActor(ctx, new Headers({ authorization: `Bearer ${key.key}` }))).actor,
    ).toMatchObject({ kind: "token", userId });
    if (state === "revoked") await revokeUserCredentials(ctx, userId);
    else
      ctx.sqlite
        .prepare("UPDATE auth_session SET expires_at = ?1 WHERE user_id = ?2")
        .run(Date.now() - 1, userId);
    const before = ctx.sqlite.query("SELECT id FROM auth_apikey").all();
    const stale = `${token}; ${data.replace("=", " =")}`;
    const response = await request("/api-key/create", "POST", { name: "revoked" }, stale);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
    expect(ctx.sqlite.query("SELECT id FROM auth_apikey").all()).toEqual(before);
    await expect(
      auth.api.updateUser({ headers: new Headers({ cookie: stale }), body: { name: "Direct" } }),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

for (const prefix of ["", "__Secure-", "__Host-"])
  for (const [name, format] of Object.entries(variants))
    test(`every Better Auth endpoint checks the session row with ${prefix || "plain"} ${name} cookies`, async () => {
      const { ctx, auth, request, userId, token, data } = await setup(prefix);
      await revokeUserCredentials(ctx, userId);
      const cookie = format(token, data);
      const endpoints = endpointsOf(auth, false);
      // Use the installed endpoint registry, so new endpoints are automatically covered.
      expect(
        endpoints.length + endpointsOf(auth, true).length + DISABLED_PATHS.length,
      ).toBeGreaterThan(30);
      for (const endpoint of endpoints) {
        for (const method of methodsOf(endpoint)) {
          const response = await request(concrete(endpoint.path!), method, {}, cookie);
          expect({ path: endpoint.path, method, status: response.status }).toEqual({
            path: endpoint.path,
            method,
            status: 401,
          });
          expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
          expect(response.headers.getSetCookie().length).toBeGreaterThan(0);
          for (const cleared of response.headers.getSetCookie())
            expect(cleared).toMatch(/^[^=]+=;.*Max-Age=0/i);
        }
      }
      // Session-less endpoints go on past the dead cookie (here to their own refusals)
      // and still expire it.
      expect(
        endpointsOf(auth, true)
          .map((endpoint) => endpoint.path!)
          .sort(),
      ).toEqual([...SESSIONLESS].sort());
      for (const endpoint of endpointsOf(auth, true))
        for (const method of methodsOf(endpoint)) {
          const response = await wellFormed(request, endpoint.path!, cookie);
          const where = { path: endpoint.path, method };
          expect({
            ...where,
            code: await codeOf(response),
          }).not.toEqual({ ...where, code: "UNAUTHORIZED" });
          const set = response.headers.getSetCookie();
          expect({ ...where, cleared: set.some((v) => /session_token=;/.test(v)) }).toEqual({
            ...where,
            cleared: true,
          });
          for (const cleared of set) expect(cleared).toMatch(/^[^=]+=;.*Max-Age=0/i);
        }
      expect((await request("/get-session", "GET", undefined, cookie)).status).toBe(200);
      expect(ctx.sqlite.query("SELECT id FROM auth_session").all()).toEqual([]);
      expect(ctx.sqlite.query("SELECT id FROM auth_apikey").all()).toEqual([]);
    });

test("duplicate tokens and mismatched cache cookies cannot select a revoked account", async () => {
  const { ctx, request, userId, token, data } = await setup();
  const other = await request("/sign-up/email", "POST", {
    name: "Other",
    username: "Other",
    email: "other@example.test",
    password: "Password123!",
  });
  expect(other.status).toBe(200);
  const otherId = Number(((await other.json()) as { user: { id: string } }).user.id);
  const otherCookies = other.headers.getSetCookie().map((value) => value.split(";")[0]!);
  const otherToken = otherCookies.find((value) => value.startsWith("sermo.session_token="))!;
  await revokeUserCredentials(ctx, userId);
  // Better Call uses the first duplicate. A live token with someone else's cache must still
  // update only the live token's account; a revoked first token must never fall through.
  const revokedFirst = await request(
    "/update-user",
    "POST",
    { name: "Wrong" },
    `${token}; ${otherToken}; ${data.replace("=", " =")}`,
  );
  expect(revokedFirst.status).toBe(401);
  const liveFirst = await request(
    "/update-user",
    "POST",
    { name: "Right" },
    `${otherToken}; ${token}; ${data.replace("=", " =")}`,
  );
  expect(liveFirst.status).toBe(200);
  expect(
    ctx.sqlite
      .prepare<{ name: string }, [number]>("SELECT name FROM auth_user WHERE id = ?1")
      .get(userId)?.name,
  ).toBe("Cached");
  expect(
    ctx.sqlite
      .prepare<{ name: string }, [number]>("SELECT name FROM auth_user WHERE id = ?1")
      .get(otherId)?.name,
  ).toBe("Right");
});

for (const prefix of ["", "__Secure-"])
  test(`every Better Auth endpoint checks the session expiry with ${prefix || "plain"} cookies`, async () => {
    const { ctx, auth, request, userId, token, data } = await setup(prefix);
    ctx.sqlite
      .prepare("UPDATE auth_session SET expires_at = ?1 WHERE user_id = ?2")
      .run(Date.now() - 1, userId);
    const cookie = `${token}; ${data.replace("=", " =")}`;
    const endpoints = endpointsOf(auth, false);
    expect(
      endpoints.length + endpointsOf(auth, true).length + DISABLED_PATHS.length,
    ).toBeGreaterThan(30);
    for (const endpoint of endpoints) {
      for (const method of methodsOf(endpoint)) {
        const response = await request(concrete(endpoint.path!), method, {}, cookie);
        expect({ path: endpoint.path, method, status: response.status }).toEqual({
          path: endpoint.path,
          method,
          status: 401,
        });
        expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
      }
    }
    for (const endpoint of endpointsOf(auth, true))
      for (const method of methodsOf(endpoint)) {
        const response = await wellFormed(request, endpoint.path!, cookie);
        const where = { path: endpoint.path, method };
        expect({ ...where, code: await codeOf(response) }).not.toEqual({
          ...where,
          code: "UNAUTHORIZED",
        });
      }
    expect(ctx.sqlite.query("SELECT id FROM auth_apikey").all()).toEqual([]);
  });

test("a cache cookie without a session token cookie authorizes nothing", async () => {
  const { ctx, request, userId, token, data } = await setup();
  const live = await request("/update-user", "POST", { name: "Live" }, `${token}; ${data}`);
  expect(live.status).toBe(200);
  await revokeUserCredentials(ctx, userId);
  const forged = token.replace(/=.*/, "=forged.signature");
  for (const cookie of [
    data,
    data.replace("=", " ="),
    `${data}; ${token.replace("=", "x=")}`,
    `${forged}; ${data}`,
    `${token.slice(0, token.indexOf("="))}=; ${data}`,
  ])
    for (const [path, body] of [
      ["/update-user", { name: "Revoked" }],
      ["/api-key/create", { name: "revoked" }],
      ["/delete-user", {}],
      ["/revoke-sessions", {}],
    ] as const) {
      const response = await request(path, "POST", body, cookie);
      expect({ cookie, path, status: response.status }).toEqual({ cookie, path, status: 401 });
    }
  expect(
    ctx.sqlite
      .prepare<{ name: string }, [number]>("SELECT name FROM auth_user WHERE id = ?1")
      .get(userId)?.name,
  ).toBe("Live");
  expect(ctx.sqlite.query("SELECT id FROM auth_apikey").all()).toEqual([]);
});

test("a tampered session token is rejected and cleared rather than ignored", async () => {
  const { request, token, data } = await setup();
  const tampered = token.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  const response = await request("/update-user", "POST", { name: "Nope" }, `${tampered}; ${data}`);
  expect(response.status).toBe(401);
  expect(response.headers.getSetCookie().some((v) => /session_token=;/.test(v))).toBe(true);
});

function kill(state: string, { ctx, userId }: Pick<Setup, "ctx" | "userId">) {
  if (state === "revoked") return revokeUserCredentials(ctx, userId);
  ctx.sqlite
    .prepare("UPDATE auth_session SET expires_at = ?1 WHERE user_id = ?2")
    .run(Date.now() - 1, userId);
}

const sessionCookies = (response: Response) =>
  response.headers.getSetCookie().filter((value) => /session_(?:token|data)/.test(value));

for (const state of ["revoked", "expired"])
  test(`a ${state} session cookie does not block sign-in and the new session replaces it`, async () => {
    const s = await setup();
    const { auth, request, token, data, cookie } = s;
    await kill(state, s);
    const wrong = await request(
      "/sign-in/username",
      "POST",
      { username: "Cached", password: "Wrong-password1" },
      cookie,
    );
    // A bad password is reported as such, not as a dead session, and the dead cookie is expired.
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ code: "INVALID_USERNAME_OR_PASSWORD" });
    expect(wrong.headers.getSetCookie().some((v) => /^sermo\.session_token=;/.test(v))).toBe(true);
    for (const path of ["/sign-in/username", "/sign-in/email"]) {
      const body =
        path === "/sign-in/email"
          ? { email: "cached@example.test", password: "Password123!" }
          : { username: "Cached", password: "Password123!" };
      const response = await request(path, "POST", body, cookie);
      expect(response.status).toBe(200);
      const set = response.headers.getSetCookie();
      // Exactly one cookie per name, and none of them expires the new session.
      for (const name of ["sermo.session_token", "sermo.session_data"]) {
        const entries = set.filter((value) => value.startsWith(`${name}=`));
        expect(entries.length).toBe(1);
        expect(isClearing(entries[0]!)).toBe(false);
      }
      const fresh = set.map((value) => value.split(";")[0]!);
      const session = await auth.api.getSession({
        headers: new Headers({ cookie: fresh.join("; ") }),
      });
      expect(session?.user.email).toBe("cached@example.test");
      expect(fresh.find((v) => v.startsWith("sermo.session_token="))).not.toBe(token);
      // The old pair is no longer in effect for anything that needs a session.
      const old = await request("/update-user", "POST", { name: "Old" }, `${token}; ${data}`);
      expect(old.status).toBe(401);
      const current = await request("/update-user", "POST", { name: "New" }, fresh.join("; "));
      expect(current.status).toBe(200);
    }
  });

for (const state of ["revoked", "expired"])
  test(`a ${state} session cookie does not block sign-up`, async () => {
    const s = await setup();
    const { ctx, auth, request, token, data } = s;
    await kill(state, s);
    const response = await request(
      "/sign-up/email",
      "POST",
      { name: "Fresh", username: "Fresh", email: "fresh@example.test", password: "Password123!" },
      `${token}; ${data}`,
    );
    expect(response.status).toBe(200);
    const set = response.headers.getSetCookie();
    for (const name of ["sermo.session_token", "sermo.session_data"]) {
      const entries = set.filter((value) => value.startsWith(`${name}=`));
      expect(entries.length).toBe(1);
      expect(isClearing(entries[0]!)).toBe(false);
    }
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: set.map((value) => value.split(";")[0]!).join("; ") }),
    });
    expect(session?.user.email).toBe("fresh@example.test");
    expect(
      ctx.sqlite
        .prepare<{ name: string }, []>(
          "SELECT name FROM auth_user WHERE email = 'fresh@example.test'",
        )
        .get()?.name,
    ).toBe("Fresh");
  });

test("a dead session token with a still-valid cache cookie is invisible to session-less endpoints", async () => {
  const s = await setup();
  const { ctx, auth, request, userId, token, data } = s;
  await revokeUserCredentials(ctx, userId);
  // The cache cookie is still correctly signed and fresh; it must not stand in for the session.
  const cookie = `${token}; ${data}`;
  const before = ctx.sqlite.query("SELECT * FROM auth_user").all();
  for (const endpoint of endpointsOf(auth, true))
    for (const method of methodsOf(endpoint)) {
      const response = await wellFormed(request, endpoint.path!, cookie);
      const where = { path: endpoint.path, method };
      expect({ ...where, status: response.status }).not.toEqual({ ...where, status: 200 });
      // Nothing is re-issued or refreshed for the revoked session: only expiring entries.
      expect({ ...where, live: sessionCookies(response).filter((v) => !isClearing(v)) }).toEqual({
        ...where,
        live: [],
      });
    }
  expect(ctx.sqlite.query("SELECT * FROM auth_user").all()).toEqual(before);
  expect(ctx.sqlite.query("SELECT id FROM auth_session").all()).toEqual([]);
  // Downstream handlers (the user-creation hook here) see no session cookie at all.
  const hooks = (await auth.$context).options.databaseHooks!.user!.create!;
  const original = hooks.before!;
  const seen: unknown[] = [];
  hooks.before = async (user, hookContext) => {
    seen.push({
      cookie: hookContext?.headers?.get("cookie") ?? null,
      token: hookContext?.getCookie("sermo.session_token") ?? null,
      data: hookContext?.getCookie("sermo.session_data") ?? null,
    });
    return original(user, hookContext);
  };
  try {
    const up = await request(
      "/sign-up/email",
      "POST",
      { name: "Fresh", username: "Fresh", email: "fresh@example.test", password: "Password123!" },
      `${cookie}; theme=dark`,
    );
    expect(up.status).toBe(200);
  } finally {
    hooks.before = original;
  }
  expect(seen).toEqual([{ cookie: "theme=dark", token: null, data: null }]);
});

async function setupMail() {
  const ctx = createTestContext();
  const capture = registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    { defaults: {}, securityTypes: new Set() },
  )!;
  registerAccountEmailJobs(ctx);
  const auth = getAuth(ctx);
  const ip = `198.51.100.${++clientNumber}`;
  const request = (path: string, method: string, body?: unknown, cookie = "") =>
    auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method,
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          "x-sermo-client-ip": ip,
          ...(cookie ? { cookie } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      }),
    );
  const up = await request("/sign-up/email", "POST", {
    name: "Mailed",
    username: "Mailed",
    email: "mailed@example.test",
    password: "Password123!",
  });
  expect(up.status).toBe(200);
  const userId = Number(((await up.json()) as { user: { id: string } }).user.id);
  const cookie = up.headers
    .getSetCookie()
    .map((value) => value.split(";")[0]!)
    .join("; ");
  const linkTo = async (pattern: RegExp) => {
    await runDueJobs(ctx);
    const message = capture.messages.findLast((m) => pattern.test(m.text))!;
    const url = new URL(message.text.match(/https?:\/\/[^\s]+/)![0]);
    return `${url.pathname.replace("/api/auth", "")}${url.search}`;
  };
  return { ctx, request, userId, cookie, linkTo };
}

const allExpired = (response: Response) => {
  const set = response.headers.getSetCookie();
  expect(set.some((v) => /^sermo\.session_token=;/.test(v))).toBe(true);
  for (const value of set) expect(value).toMatch(/^[^=]+=;.*Max-Age=0/i);
};

test("a dead session cookie does not block the password reset flow", async () => {
  const { ctx, request, userId, cookie, linkTo } = await setupMail();
  await revokeUserCredentials(ctx, userId);
  const requested = await request(
    "/request-password-reset",
    "POST",
    { email: "mailed@example.test", redirectTo: `${ORIGIN}/reset` },
    cookie,
  );
  expect(requested.status).toBe(200);
  expect(await requested.json()).toMatchObject({ status: true });
  allExpired(requested);
  const opened = await request(await linkTo(/reset-password\//), "GET", undefined, cookie);
  expect(opened.status).toBe(302);
  const token = new URL(opened.headers.get("location")!).searchParams.get("token")!;
  expect(token).toBeTruthy();
  allExpired(opened);
  const body = { newPassword: "Another-pass1", token };
  const reset = await request("/reset-password", "POST", body, cookie);
  expect(reset.status).toBe(200);
  expect(await reset.json()).toMatchObject({ status: true });
  allExpired(reset);
  const credentials = { username: "Mailed", password: "Another-pass1" };
  expect((await request("/sign-in/username", "POST", credentials, cookie)).status).toBe(200);
});

test("a dead session cookie does not block opening an email verification link", async () => {
  const { ctx, request, userId, cookie, linkTo } = await setupMail();
  const link = await linkTo(/verify-email/);
  await revokeUserCredentials(ctx, userId);
  const opened = await request(link, "GET", undefined, cookie);
  expect(opened.status).toBe(302);
  expect(opened.headers.get("location")).toBe("/");
  allExpired(opened);
  expect(
    ctx.sqlite
      .prepare<{ email_verified: number }, [number]>(
        "SELECT email_verified FROM auth_user WHERE id = ?1",
      )
      .get(userId)?.email_verified,
  ).toBe(1);
});

test("the session-less allow-list is exactly the endpoints verified not to read a session", () => {
  expect([...SESSIONLESS_PATHS].sort()).toEqual([...SESSIONLESS].sort());
});
