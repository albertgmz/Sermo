import { expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { GUEST } from "../../actor";
import { DEFAULT_CONFIG } from "../../context";
import * as authSchema from "../../db/auth-schema";
import * as forumSchema from "../../db/schema";
import { ConflictError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { authMeOp, ensureAdmin, getAuth, purgeExpiredCredentials, resolveActor } from "./index";

const identity = {
  name: "Alice",
  email: "alice@example.test",
  password: "password123",
  username: "Alice_1",
};
async function signUp(
  ctx: ReturnType<typeof createTestContext>,
  body: typeof identity & { displayUsername?: string } = identity,
) {
  const response = await getAuth(ctx).api.signUpEmail({ body, asResponse: true });
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  return { response, cookie, user: (await response.json()) as { user: { id: string } } };
}

test("registration creates identity, password account and member profile", async () => {
  const ctx = createTestContext();
  const { response, cookie, user } = await signUp(ctx);
  expect(response.status).toBe(200);
  const profile = ctx.sqlite
    .prepare<{ username: string; group_id: number }, [number]>(
      "SELECT username, group_id FROM users WHERE id = ?1",
    )
    .get(Number(user.user.id));
  expect(profile).toEqual({ username: "Alice_1", group_id: 2 });
  expect(
    ctx.sqlite
      .prepare("SELECT id FROM auth_account WHERE user_id = ?1 AND password IS NOT NULL")
      .get(Number(user.user.id)),
  ).toBeTruthy();
  expect((await resolveActor(ctx, new Headers({ cookie }))).actor).toMatchObject({
    kind: "user",
    userId: Number(user.user.id),
  });
});

test("display usernames cannot claim another normalized username", async () => {
  const ctx = createTestContext();
  const auth = getAuth(ctx);
  await expect(
    auth.api.signUpEmail({
      body: { ...identity, username: "attacker", displayUsername: "Admin_1" },
    }),
  ).rejects.toMatchObject({ statusCode: 400, body: { code: "INVALID_DISPLAY_USERNAME" } });
  const registered = await signUp(ctx, { ...identity, displayUsername: "ALICE_1" });
  const row = ctx.sqlite
    .prepare<{ username_key: string }, [number]>("SELECT username_key FROM users WHERE id = ?1")
    .get(Number(registered.user.user.id));
  expect(row?.username_key).toBe("alice_1");
  await expect(
    auth.api.updateUser({
      headers: new Headers({ cookie: registered.cookie }),
      body: { username: "alice_2", displayUsername: "Admin_1" },
    }),
  ).rejects.toMatchObject({ statusCode: 400, body: { code: "INVALID_DISPLAY_USERNAME" } });
  await expect(
    auth.api.updateUser({
      headers: new Headers({ cookie: registered.cookie }),
      body: { displayUsername: "Admin_1" },
    }),
  ).rejects.toMatchObject({ statusCode: 400, body: { code: "INVALID_DISPLAY_USERNAME" } });
  expect(
    ctx.sqlite
      .prepare<{ username_key: string }, [number]>("SELECT username_key FROM users WHERE id = ?1")
      .get(Number(registered.user.user.id))?.username_key,
  ).toBe("alice_1");
});

test("username validation rejects boundaries and duplicates while allowing Unicode", async () => {
  const ctx = createTestContext();
  await signUp(ctx);
  const auth = getAuth(ctx);
  for (const [username, code] of [
    ["ab", "USERNAME_TOO_SHORT"],
    ["a".repeat(33), "USERNAME_TOO_LONG"],
    [".alice", "INVALID_USERNAME"],
    ["alice.", "INVALID_USERNAME"],
    [" alice", "INVALID_USERNAME"],
    ["alice ", "INVALID_USERNAME"],
    ["ALICE_1", "USERNAME_IS_ALREADY_TAKEN"],
  ] as const) {
    await expect(
      auth.api.signUpEmail({
        body: {
          name: username,
          email: `${username.length}-${code}@example.test`,
          password: "password123",
          username,
        },
      }),
    ).rejects.toMatchObject({ body: { code } });
  }
  const unicode = await signUp(ctx, {
    name: "Éloise",
    email: "eloise@example.test",
    password: "password123",
    username: "Éloise",
  });
  expect(unicode.response.status).toBe(200);
});

test("forum username uniqueness errors become bad requests", async () => {
  const createCtx = createTestContext();
  createCtx.sqlite.run(
    "CREATE TRIGGER reject_forum_insert BEFORE INSERT ON users BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: users.username_key'); END",
  );
  await expect(getAuth(createCtx).api.signUpEmail({ body: identity })).rejects.toMatchObject({
    statusCode: 400,
    body: { code: "USERNAME_IS_ALREADY_TAKEN" },
  });

  const updateCtx = createTestContext();
  const { cookie } = await signUp(updateCtx);
  updateCtx.sqlite.run(
    "CREATE TRIGGER reject_forum_update BEFORE UPDATE OF username_key ON users BEGIN SELECT RAISE(ABORT, 'UNIQUE constraint failed: users.username_key'); END",
  );
  await expect(
    getAuth(updateCtx).api.updateUser({
      headers: new Headers({ cookie }),
      body: { username: "Alice_2" },
    }),
  ).rejects.toMatchObject({ statusCode: 400, body: { code: "USERNAME_IS_ALREADY_TAKEN" } });
});

test("ensureAdmin refuses a conflicting existing account", async () => {
  const input = { username: "Admin_1", email: "admin@example.test", password: "password123" };
  for (const mismatch of ["email", "password"] as const) {
    const ctx = createTestContext();
    await signUp(ctx, {
      name: "Admin",
      username: input.username,
      email: mismatch === "email" ? "other@example.test" : input.email,
      password: mismatch === "password" ? "otherpassword" : input.password,
    });
    await expect(ensureAdmin(ctx, input)).rejects.toBeInstanceOf(ConflictError);
    expect(
      ctx.sqlite
        .query<{ n: number }, []>("SELECT count(*) AS n FROM users WHERE group_id = 4")
        .get()?.n,
    ).toBe(0);
  }
});

test("duplicate and invalid registrations are rejected", async () => {
  const ctx = createTestContext();
  await signUp(ctx);
  await expect(
    getAuth(ctx).api.signUpEmail({ body: { ...identity, username: "Another" } }),
  ).rejects.toMatchObject({
    statusCode: 422,
    body: { code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" },
  });
  await expect(
    getAuth(ctx).api.signUpEmail({ body: { ...identity, email: "other@example.test" } }),
  ).rejects.toMatchObject({ statusCode: 400, body: { code: "USERNAME_IS_ALREADY_TAKEN" } });
  await expect(
    getAuth(ctx).api.signUpEmail({
      body: { ...identity, email: "bad@example.test", username: "bad!" },
    }),
  ).rejects.toMatchObject({ body: { code: "INVALID_USERNAME" } });
  await expect(
    getAuth(ctx).api.signUpEmail({
      body: { name: "No name", email: "noname@example.test", password: "password123" },
    }),
  ).rejects.toMatchObject({ statusCode: 400, body: { code: "USERNAME_REQUIRED" } });
});

test("email and username sign-in resolve sessions; wrong password fails", async () => {
  const ctx = createTestContext();
  const registered = await signUp(ctx);
  const email = await getAuth(ctx).api.signInEmail({
    body: { email: identity.email, password: identity.password },
    asResponse: true,
  });
  const username = await getAuth(ctx).api.signInUsername({
    body: { username: identity.username, password: identity.password },
    asResponse: true,
  });
  for (const response of [email, username]) {
    expect(response.status).toBe(200);
    expect(
      (await resolveActor(ctx, new Headers({ cookie: response.headers.get("set-cookie") ?? "" })))
        .actor,
    ).toMatchObject({ kind: "user", userId: Number(registered.user.user.id) });
  }
  await expect(
    getAuth(ctx).api.signInEmail({ body: { email: identity.email, password: "wrongpass" } }),
  ).rejects.toMatchObject({ statusCode: 401 });
  await expect(
    getAuth(ctx).api.signInUsername({
      body: { username: identity.username, password: "wrongpass" },
    }),
  ).rejects.toMatchObject({ statusCode: 401, body: { code: "INVALID_USERNAME_OR_PASSWORD" } });
});

test("sign-out removes the session and clears cookies", async () => {
  const ctx = createTestContext();
  await signUp(ctx);
  const signedIn = await getAuth(ctx).api.signInEmail({
    body: { email: identity.email, password: identity.password },
    asResponse: true,
  });
  const cookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const headers = new Headers({ cookie });
  expect(await getAuth(ctx).api.getSession({ headers })).not.toBeNull();
  const response = await getAuth(ctx).api.signOut({ headers, asResponse: true });
  expect(response.status).toBe(200);
  expect(response.headers.get("set-cookie")).toContain("sermo.session_token=");
  expect(
    await getAuth(ctx).api.getSession({ headers, query: { disableCookieCache: true } }),
  ).toBeNull();
  const cleared = response.headers
    .getSetCookie()
    .filter((value) => !/max-age=0/i.test(value))
    .map((value) => value.split(";")[0])
    .join("; ");
  expect((await resolveActor(ctx, new Headers({ cookie: cleared }))).actor).toEqual(GUEST);
});

test("a revoked session cookie can remain valid until its cache expires", async () => {
  const ctx = createTestContext();
  const { cookie } = await signUp(ctx);
  const headers = new Headers({ cookie });
  await getAuth(ctx).api.revokeSessions({ headers });
  expect((await resolveActor(ctx, headers)).actor.kind).toBe("user");
});

test("session-token resolution returns a cache cookie and reuses it without session SQL", async () => {
  const ctx = createTestContext();
  const { cookie } = await signUp(ctx);
  const tokenCookie = cookie.split("; ").find((part) => part.startsWith("sermo.session_token="))!;
  const queries: string[] = [];
  const rawQueries: string[] = [];
  const originalPrepare = ctx.sqlite.prepare.bind(ctx.sqlite);
  const originalQuery = ctx.sqlite.query.bind(ctx.sqlite);
  const track = (sql: string, statement: object) => {
    for (const method of ["get", "all", "run"] as const) {
      const original = Reflect.get(statement, method) as (...args: unknown[]) => unknown;
      Reflect.set(statement, method, (...args: unknown[]) => {
        rawQueries.push(sql);
        return Reflect.apply(original, statement, args);
      });
    }
    return statement;
  };
  Reflect.set(ctx.sqlite, "prepare", (sql: string) => track(sql, originalPrepare(sql)));
  Reflect.set(ctx.sqlite, "query", (sql: string) => track(sql, originalQuery(sql)));
  const tracedCtx = {
    ...ctx,
    db: drizzle({
      client: ctx.sqlite,
      schema: { ...forumSchema, ...authSchema },
      logger: { logQuery: (sql: string) => queries.push(sql) },
    }),
  };
  try {
    const before = ctx.sqlite
      .query<{ count: number }, []>("SELECT total_changes() AS count")
      .get()!.count;
    const first = await resolveActor(tracedCtx, new Headers({ cookie: tokenCookie }));
    expect(first.actor.kind).toBe("user");
    expect(
      ctx.sqlite.query<{ count: number }, []>("SELECT total_changes() AS count").get()!.count,
    ).toBe(before);
    const cacheCookie = first.setCookies.find((part) => part.startsWith("sermo.session_data="));
    expect(cacheCookie).toBeDefined();
    expect(queries.some((sql) => /auth_session/.test(sql))).toBe(true);
    const fullCookie = `${tokenCookie}; ${cacheCookie!.split(";")[0]}`;
    queries.length = 0;
    rawQueries.length = 0;
    expect(
      await getAuth(tracedCtx).api.getSession({ headers: new Headers({ cookie: fullCookie }) }),
    ).not.toBeNull();
    expect(queries).toEqual([]);
    expect(rawQueries).toEqual([]);
    const second = await resolveActor(tracedCtx, new Headers({ cookie: fullCookie }));
    expect(second.actor).toEqual(first.actor);
    expect(queries).toEqual([]);
    expect(rawQueries).toContain("SELECT group_id FROM users WHERE id = ?1");
    ctx.sqlite
      .prepare("UPDATE users SET group_id = 3 WHERE id = ?1")
      .run(first.actor.kind === "guest" ? 0 : first.actor.userId);
    const updated = await resolveActor(tracedCtx, new Headers({ cookie: fullCookie }));
    expect(updated.actor).toMatchObject({ groupId: 3 });
  } finally {
    Reflect.set(ctx.sqlite, "prepare", originalPrepare);
    Reflect.set(ctx.sqlite, "query", originalQuery);
  }
});

test("expired sessions and invalid presented credentials reject", async () => {
  const ctx = createTestContext();
  const { cookie } = await signUp(ctx);
  ctx.sqlite.run("UPDATE auth_session SET expires_at = 1");
  const tokenOnly = cookie.split(",")[0]!.split(";")[0]!;
  const before = ctx.sqlite
    .query<{ count: number }, []>("SELECT total_changes() AS count")
    .get()!.count;
  await expect(resolveActor(ctx, new Headers({ cookie: tokenOnly }))).rejects.toBeInstanceOf(
    UnauthenticatedError,
  );
  expect(
    ctx.sqlite.query<{ count: number }, []>("SELECT total_changes() AS count").get()!.count,
  ).toBe(before);
  await expect(
    resolveActor(ctx, new Headers({ authorization: "Bearer garbage" })),
  ).rejects.toBeInstanceOf(UnauthenticatedError);
  await expect(
    resolveActor(ctx, new Headers({ cookie: "sermo.session_token=garbage" })),
  ).rejects.toBeInstanceOf(UnauthenticatedError);
});

test("API keys resolve read-only, and revoked, disabled and expired keys reject", async () => {
  const ctx = createTestContext();
  const { cookie, user } = await signUp(ctx);
  const created = await getAuth(ctx).api.createApiKey({
    headers: new Headers({ cookie }),
    body: { name: "test" },
  });
  const before = ctx.sqlite
    .query<{ count: number }, []>("SELECT total_changes() AS count")
    .get()!.count;
  const bearer = await resolveActor(ctx, new Headers({ authorization: `Bearer ${created.key}` }));
  const after = ctx.sqlite
    .query<{ count: number }, []>("SELECT total_changes() AS count")
    .get()!.count;
  expect(after).toBe(before);
  expect(bearer.actor).toMatchObject({
    kind: "token",
    userId: Number(user.user.id),
    tokenId: Number(created.id),
  });
  expect(await resolveActor(ctx, new Headers({ "x-api-key": created.key }))).toEqual(bearer);
  for (const authorization of ["Token garbage", "Basic garbage", created.key, "Bearer garbage"]) {
    await expect(
      resolveActor(ctx, new Headers({ authorization, "x-api-key": created.key, cookie })),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  }
  expect(
    (
      await resolveActor(
        ctx,
        new Headers({ authorization: `Bearer ${created.key}`, "x-api-key": "garbage" }),
      )
    ).actor,
  ).toEqual(bearer.actor);
  ctx.sqlite.prepare("UPDATE auth_apikey SET enabled = 0 WHERE id = ?1").run(Number(created.id));
  await expect(resolveActor(ctx, new Headers({ "x-api-key": created.key }))).rejects.toBeInstanceOf(
    UnauthenticatedError,
  );
  ctx.sqlite
    .prepare("UPDATE auth_apikey SET enabled = 1, expires_at = ?1 WHERE id = ?2")
    .run(Date.now() - 1, Number(created.id));
  await expect(resolveActor(ctx, new Headers({ "x-api-key": created.key }))).rejects.toBeInstanceOf(
    UnauthenticatedError,
  );
  ctx.sqlite
    .prepare("UPDATE auth_apikey SET expires_at = NULL WHERE id = ?1")
    .run(Number(created.id));
  await getAuth(ctx).api.deleteApiKey({
    headers: new Headers({ cookie }),
    body: { keyId: created.id },
  });
  await expect(resolveActor(ctx, new Headers({ "x-api-key": created.key }))).rejects.toBeInstanceOf(
    UnauthenticatedError,
  );
});

test("API key reference ids require decimal safe positive integers", async () => {
  const ctx = createTestContext();
  const { cookie } = await signUp(ctx);
  const key = await getAuth(ctx).api.createApiKey({
    headers: new Headers({ cookie }),
    body: { name: "key" },
  });
  for (const referenceId of ["1e0", "-1", "0", "9007199254740992"]) {
    ctx.sqlite
      .prepare("UPDATE auth_apikey SET reference_id = ?1 WHERE id = ?2")
      .run(referenceId, Number(key.id));
    await expect(resolveActor(ctx, new Headers({ "x-api-key": key.key }))).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
  }
});

test("another user cannot delete an API key", async () => {
  const ctx = createTestContext();
  const a = await signUp(ctx);
  const b = await signUp(ctx, {
    name: "Bob",
    email: "bob@example.test",
    password: "password123",
    username: "Bob_1",
  });
  const key = await getAuth(ctx).api.createApiKey({
    headers: new Headers({ cookie: a.cookie }),
    body: { name: "mine" },
  });
  await expect(
    getAuth(ctx).api.deleteApiKey({
      headers: new Headers({ cookie: b.cookie }),
      body: { keyId: key.id },
    }),
  ).rejects.toMatchObject({ statusCode: 404, body: { code: "KEY_NOT_FOUND" } });
  expect(
    ctx.sqlite.prepare("SELECT id FROM auth_apikey WHERE id = ?1").get(Number(key.id)),
  ).toBeTruthy();
});

test("missing forum profile is repaired when resolving a session", async () => {
  const ctx = createTestContext();
  const { cookie, user } = await signUp(ctx);
  ctx.sqlite.prepare("DELETE FROM users WHERE id = ?1").run(Number(user.user.id));
  expect((await resolveActor(ctx, new Headers({ cookie }))).actor).toMatchObject({ groupId: 2 });
  expect(
    ctx.sqlite.prepare("SELECT id FROM users WHERE id = ?1").get(Number(user.user.id)),
  ).toBeTruthy();
});

test("missing forum profile is repaired when resolving an API key", async () => {
  const ctx = createTestContext();
  const { cookie, user } = await signUp(ctx);
  const key = await getAuth(ctx).api.createApiKey({
    headers: new Headers({ cookie }),
    body: { name: "repair" },
  });
  ctx.sqlite.prepare("DELETE FROM users WHERE id = ?1").run(Number(user.user.id));
  expect((await resolveActor(ctx, new Headers({ "x-api-key": key.key }))).actor).toMatchObject({
    kind: "token",
    groupId: 2,
  });
  expect(
    ctx.sqlite
      .prepare<{ username_key: string }, [number]>("SELECT username_key FROM users WHERE id = ?1")
      .get(Number(user.user.id))?.username_key,
  ).toBe("alice_1");
});

test("username updates keep the forum profile in sync", async () => {
  const ctx = createTestContext();
  const { cookie, user } = await signUp(ctx);
  await getAuth(ctx).api.updateUser({
    headers: new Headers({ cookie }),
    body: { username: "Alice_2" },
  });
  expect(
    ctx.sqlite
      .prepare<{ username: string; username_key: string }, [number]>(
        "SELECT username, username_key FROM users WHERE id = ?1",
      )
      .get(Number(user.user.id)),
  ).toEqual({ username: "Alice_2", username_key: "alice_2" });
  expect(
    ctx.sqlite
      .prepare<{ display_username: string }, [number]>(
        "SELECT display_username FROM auth_user WHERE id = ?1",
      )
      .get(Number(user.user.id))?.display_username,
  ).toBe("Alice_2");
  await getAuth(ctx).api.updateUser({
    headers: new Headers({ cookie }),
    body: { username: "Alice_3", displayUsername: "Alice_3" },
  });
  expect(
    ctx.sqlite
      .prepare<{ username: string }, [number]>("SELECT username FROM users WHERE id = ?1")
      .get(Number(user.user.id))?.username,
  ).toBe("Alice_3");
});

test("username and display username cannot be cleared", async () => {
  const ctx = createTestContext();
  const { cookie, user } = await signUp(ctx);
  const headers = new Headers({ cookie });
  for (const body of [{ username: null }, { displayUsername: null }]) {
    await expect(getAuth(ctx).api.updateUser({ headers, body })).rejects.toMatchObject({
      statusCode: 400,
    });
  }
  expect(
    ctx.sqlite
      .prepare<{ username: string; display_username: string }, [number]>(
        "SELECT username, display_username FROM auth_user WHERE id = ?1",
      )
      .get(Number(user.user.id)),
  ).toEqual({ username: "alice_1", display_username: "Alice_1" });
});

test("display-only case changes preserve the normalized username", async () => {
  const ctx = createTestContext();
  const { cookie, user } = await signUp(ctx);
  await getAuth(ctx).api.updateUser({
    headers: new Headers({ cookie }),
    body: { displayUsername: "ALICE_1" },
  });
  expect(
    ctx.sqlite
      .prepare<{ username: string; username_key: string }, [number]>(
        "SELECT username, username_key FROM users WHERE id = ?1",
      )
      .get(Number(user.user.id)),
  ).toEqual({ username: "ALICE_1", username_key: "alice_1" });
});

test("auth.me returns guest, member, moderator, admin and token permissions", async () => {
  const ctx = createTestContext();
  expect(await execute(ctx, authMeOp, GUEST, {})).toEqual({
    user: null,
    permissions: {
      isAdmin: false,
      isModerator: false,
      canViewProfiles: true,
      canPostProfile: false,
      canStartConversations: false,
      canReact: false,
    },
  });
  for (const groupId of [2, 3, 4]) {
    const user = insertUser(ctx, { groupId });
    const me = await execute(ctx, authMeOp, userActor(user), {});
    expect(me.user?.groupId).toBe(groupId);
    expect(me.permissions.isAdmin).toBe(groupId === 4);
    expect((await execute(ctx, authMeOp, tokenActor(user), {})).user?.id).toBe(user.id);
  }
});

test("ensureAdmin creates once or promotes an existing account", async () => {
  const ctx = createTestContext();
  const input = { username: "Admin_1", email: "admin@example.test", password: "password123" };
  const first = await ensureAdmin(ctx, input);
  expect(first.created).toBe(true);
  expect((await ensureAdmin(ctx, input)).userId).toBe(first.userId);
  expect(
    await ensureAdmin(ctx, {
      username: "Attacker",
      email: "other@example.test",
      password: "wrongpassword",
    }),
  ).toEqual({ userId: first.userId, created: false });
  expect(
    ctx.sqlite
      .prepare<{ group_id: number }, [number]>("SELECT group_id FROM users WHERE id = ?1")
      .get(first.userId)?.group_id,
  ).toBe(4);
  const other = createTestContext();
  const existing = await signUp(other, { ...input, name: "Admin" });
  expect((await ensureAdmin(other, input)).userId).toBe(Number(existing.user.user.id));
  const broken = createTestContext();
  const account = await signUp(broken, { ...input, name: "Admin" });
  broken.sqlite.prepare("DELETE FROM users WHERE id = ?1").run(Number(account.user.user.id));
  expect((await ensureAdmin(broken, input)).userId).toBe(Number(account.user.user.id));
});

test("purgeExpiredCredentials keeps live rows", async () => {
  const ctx = createTestContext();
  const { cookie } = await signUp(ctx);
  const key = await getAuth(ctx).api.createApiKey({
    headers: new Headers({ cookie }),
    body: { name: "key" },
  });
  const second = await getAuth(ctx).api.signInEmail({
    body: { email: identity.email, password: identity.password },
    asResponse: true,
  });
  const secondCookie = second.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  await getAuth(ctx).api.createApiKey({
    headers: new Headers({ cookie: secondCookie }),
    body: { name: "live" },
  });
  ctx.sqlite.run(
    "INSERT INTO auth_verification (identifier, value, expires_at, created_at, updated_at) VALUES ('old', 'x', 1, 1, 1), ('live', 'x', 9999999999999, 1, 1)",
  );
  ctx.sqlite.run(
    "UPDATE auth_session SET expires_at = 1 WHERE id = (SELECT min(id) FROM auth_session)",
  );
  ctx.sqlite.prepare("UPDATE auth_apikey SET expires_at = 1 WHERE id = ?1").run(Number(key.id));
  expect(purgeExpiredCredentials(ctx)).toEqual({ sessions: 1, apiKeys: 1, verifications: 1 });
  expect(
    ctx.sqlite.query<{ n: number }, []>("SELECT count(*) AS n FROM auth_session").get()?.n,
  ).toBe(1);
  expect(
    ctx.sqlite.query<{ n: number }, []>("SELECT count(*) AS n FROM auth_apikey").get()?.n,
  ).toBe(1);
  expect(
    ctx.sqlite.query<{ n: number }, []>("SELECT count(*) AS n FROM auth_verification").get()?.n,
  ).toBe(1);
});

test("handler rate limits sign-in by IP", async () => {
  const ctx = createTestContext();
  const auth = getAuth(ctx);
  const request = (ip: string, spoofedIp: string) =>
    auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sermo-client-ip": ip,
          "x-forwarded-for": spoofedIp,
          "x-real-ip": spoofedIp,
        },
        body: JSON.stringify({ email: "missing@example.test", password: "password123" }),
      }),
    );
  const statuses: number[] = [];
  for (let i = 0; i < 4; i++) {
    const response = await request("192.0.2.1", `198.51.100.${i + 1}`);
    statuses.push(response.status);
  }
  expect(statuses).toContain(429);
  expect((await request("192.0.2.2", "198.51.100.1")).status).not.toBe(429);
});

test("cross-origin cookie POST is rejected", async () => {
  const ctx = createTestContext();
  const response = await getAuth(ctx).handler(
    new Request("http://localhost:3000/api/auth/sign-out", {
      method: "POST",
      headers: {
        cookie: "sermo.session_token=garbage",
        origin: "https://evil.example",
        "x-sermo-client-ip": "192.0.2.3",
      },
    }),
  );
  expect(response.status).toBe(403);
});

test("production uses Bun default argon2id cost", async () => {
  expect(DEFAULT_CONFIG.passwordHash).toEqual({ algorithm: "argon2id" });
  expect(await Bun.password.hash("password123", DEFAULT_CONFIG.passwordHash)).toStartWith(
    "$argon2id$v=19$m=65536,t=2",
  );
});

test("getAuth requires auth configuration", () => {
  const ctx = createTestContext();
  ctx.config.auth = undefined;
  expect(() => getAuth(ctx)).toThrow("Better Auth requires ctx.config.auth.");
});

test("hot credential and self lookups use indexes", () => {
  const ctx = createTestContext();
  expectNoTableScan(
    ctx,
    "SELECT id, reference_id, enabled, expires_at FROM auth_apikey WHERE key = ?1",
    ["hash"],
  );
  expectNoTableScan(ctx, "SELECT group_id FROM users WHERE id = ?1", [1]);
  expectNoTableScan(
    ctx,
    "SELECT u.id, u.username, a.email, u.group_id, u.created_at FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1",
    [1],
  );
});
