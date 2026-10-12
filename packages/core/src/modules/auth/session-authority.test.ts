import { expect, test } from "bun:test";
import { createTestContext } from "@sermo/core/testing";
import { getAuth, resolveActor, revokeUserCredentials } from "./index";

const ORIGIN = "http://localhost:3000";
let clientNumber = 0;

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
    const live = await request("/api-key/create", "POST", { name: "live" }, cookie);
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
      const endpoints = Object.values(auth.api).filter(
        (endpoint) => endpoint.path && endpoint.path !== "/get-session",
      );
      // Use the installed endpoint registry, so new endpoints are automatically covered.
      expect(endpoints.length).toBeGreaterThan(30);
      for (const endpoint of endpoints) {
        const methods = Array.isArray(endpoint.options.method)
          ? endpoint.options.method
          : [endpoint.options.method];
        for (const method of methods) {
          const response = await request(
            endpoint.path!.replace(":id", "unknown").replace(":token", "unknown"),
            method,
            {},
            cookie,
          );
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

test("rejecting a revoked session clears its cookies so the client can sign in again", async () => {
  const { ctx, request, userId, cookie } = await setup();
  await revokeUserCredentials(ctx, userId);
  const rejected = await request(
    "/sign-in/username",
    "POST",
    {
      username: "Cached",
      password: "Password123!",
    },
    cookie,
  );
  expect(rejected.status).toBe(401);
  const cleared = rejected.headers.getSetCookie();
  for (const name of ["sermo.session_token", "sermo.session_data"])
    expect(cleared.some((value) => value.startsWith(`${name}=;`) && /Max-Age=0/i.test(value))).toBe(
      true,
    );
  expect(
    (await request("/sign-in/username", "POST", { username: "Cached", password: "Password123!" }))
      .status,
  ).toBe(200);
});

for (const prefix of ["", "__Secure-"])
  test(`every Better Auth endpoint checks the session expiry with ${prefix || "plain"} cookies`, async () => {
    const { ctx, auth, request, userId, token, data } = await setup(prefix);
    ctx.sqlite
      .prepare("UPDATE auth_session SET expires_at = ?1 WHERE user_id = ?2")
      .run(Date.now() - 1, userId);
    const cookie = `${token}; ${data.replace("=", " =")}`;
    const endpoints = Object.values(auth.api).filter(
      (endpoint) => endpoint.path && endpoint.path !== "/get-session",
    );
    expect(endpoints.length).toBeGreaterThan(30);
    for (const endpoint of endpoints) {
      const methods = Array.isArray(endpoint.options.method)
        ? endpoint.options.method
        : [endpoint.options.method];
      for (const method of methods) {
        const response = await request(
          endpoint.path!.replace(":id", "unknown").replace(":token", "unknown"),
          method,
          {},
          cookie,
        );
        expect({ path: endpoint.path, method, status: response.status }).toEqual({
          path: endpoint.path,
          method,
          status: 401,
        });
        expect(await response.json()).toMatchObject({ code: "UNAUTHORIZED" });
      }
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

test("rejecting an expired session clears its cookies so the client can sign in again", async () => {
  const { ctx, request, userId, cookie } = await setup();
  ctx.sqlite
    .prepare("UPDATE auth_session SET expires_at = ?1 WHERE user_id = ?2")
    .run(Date.now() - 1, userId);
  const rejected = await request(
    "/sign-in/username",
    "POST",
    { username: "Cached", password: "Password123!" },
    cookie,
  );
  expect(rejected.status).toBe(401);
  const cleared = rejected.headers.getSetCookie();
  for (const name of ["sermo.session_token", "sermo.session_data"])
    expect(cleared.some((value) => value.startsWith(`${name}=;`) && /Max-Age=0/i.test(value))).toBe(
      true,
    );
  expect(
    (await request("/sign-in/username", "POST", { username: "Cached", password: "Password123!" }))
      .status,
  ).toBe(200);
});

test("a tampered session token is rejected and cleared rather than ignored", async () => {
  const { request, token, data } = await setup();
  const tampered = token.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  const response = await request("/update-user", "POST", { name: "Nope" }, `${tampered}; ${data}`);
  expect(response.status).toBe(401);
  expect(response.headers.getSetCookie().some((v) => /session_token=;/.test(v))).toBe(true);
});
