import { expect, test } from "bun:test";
import { userActor } from "@sermo/core/testing";
import { createContext } from "../../context";
import { UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { getAuth, resolveActor } from "./index";

const ORIGIN = "http://localhost:3000";
let clientNumber = 0;

function contextWith(sessionCookieCache?: boolean) {
  return createContext({
    path: ":memory:",
    migrate: true,
    config: {
      passwordHash: { algorithm: "argon2id", memoryCost: 8, timeCost: 1 },
      validateOutput: true,
      auth: {
        secret: "test-secret-for-sermo-tests-0123456789abcdef",
        baseURL: ORIGIN,
        trustedOrigins: [],
        clientIpHeader: "x-sermo-client-ip",
        ...(sessionCookieCache === undefined ? {} : { sessionCookieCache }),
      },
    },
  });
}

async function signUpAndIn(ctx: ReturnType<typeof contextWith>, name = "Plain") {
  const ip = `192.0.2.${++clientNumber + 80}`;
  const post = (path: string, body: unknown) =>
    getAuth(ctx).handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "x-sermo-client-ip": ip,
        },
        body: JSON.stringify(body),
      }),
    );
  const up = await post("/sign-up/email", {
    name,
    username: name,
    email: `${name.toLowerCase()}@example.test`,
    password: "Password123!",
  });
  expect(up.status).toBe(200);
  const userId = Number(((await up.json()) as { user: { id: string } }).user.id);
  const inResponse = await post("/sign-in/email", {
    email: `${name.toLowerCase()}@example.test`,
    password: "Password123!",
  });
  expect(inResponse.status).toBe(200);
  const cookies = inResponse.headers.getSetCookie().map((value) => value.split(";")[0]!);
  return {
    userId,
    post,
    signIn: inResponse,
    token: cookies.find((value) => value.startsWith("sermo.session_token="))!,
  };
}

test("without the session cookie cache nothing is written back and no cache cookie is set", async () => {
  const ctx = contextWith(false);
  const { userId, signIn, token } = await signUpAndIn(ctx);
  expect(token).toBeDefined();
  expect(signIn.headers.getSetCookie().some((value) => /session_data/.test(value))).toBe(false);
  const resolved = await resolveActor(ctx, new Headers({ cookie: token }));
  expect(resolved.actor).toMatchObject({ kind: "user", userId });
  expect(resolved.setCookies).toEqual([]);
});

test("without the session cookie cache a revoked session stops working at once", async () => {
  const ctx = contextWith(false);
  const { userId, signIn } = await signUpAndIn(ctx);
  // Every cookie of the sign-in: with the cache on, the cached copy would outlive the session.
  const cookie = signIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const headers = new Headers({ cookie });
  expect((await resolveActor(ctx, headers)).actor.kind).toBe("user");
  ctx.sqlite.prepare("DELETE FROM auth_session WHERE user_id = ?1").run(userId);
  await expect(resolveActor(ctx, headers)).rejects.toBeInstanceOf(UnauthenticatedError);
});

for (const [label, value] of [
  ["unset", undefined],
  ["true", true],
] as const)
  test(`with the session cookie cache ${label} the cache cookie is still issued`, async () => {
    const ctx = contextWith(value);
    const { signIn, token } = await signUpAndIn(ctx);
    expect(signIn.headers.getSetCookie().some((v) => /session_data=[^;]/.test(v))).toBe(true);
    const resolved = await resolveActor(ctx, new Headers({ cookie: token }));
    expect(resolved.setCookies.some((v) => v.startsWith("sermo.session_data="))).toBe(true);
  });

// Revocation with the cache on: the member's cookie must stop at once, not when the cache expires.

const cookieOf = (signIn: Response) =>
  signIn.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");

async function cachedWorld() {
  const ctx = contextWith(true);
  const member = await signUpAndIn(ctx, "Plain");
  const boss = await signUpAndIn(ctx, "Boss");
  ctx.sqlite.prepare("UPDATE users SET group_id = 4 WHERE id = ?1").run(boss.userId);
  const admin = userActor({ id: boss.userId, groupId: 4 });
  const headers = new Headers({ cookie: cookieOf(member.signIn) });
  // The cache cookie is in use: the first resolution answers from it.
  expect(headers.get("cookie")).toMatch(/session_data=/);
  expect((await resolveActor(ctx, headers)).actor).toMatchObject({
    kind: "user",
    userId: member.userId,
  });
  const run = (name: string, input: object) =>
    execute(ctx, getOperation(name), admin, { userId: member.userId, ...input });
  return { ctx, member, headers, run, admin };
}

test("with the cache on, signing a member out of every session cuts their cached cookie at once", async () => {
  const w = await cachedWorld();
  await w.run("users.adminRevokeSessions", {});
  await expect(resolveActor(w.ctx, w.headers)).rejects.toBeInstanceOf(UnauthenticatedError);
  // A session that starts afterwards is the member's own again.
  await Bun.sleep(5);
  const again = await w.member.post("/sign-in/email", {
    email: "plain@example.test",
    password: "Password123!",
  });
  const fresh = new Headers({ cookie: cookieOf(again) });
  expect((await resolveActor(w.ctx, fresh)).actor).toMatchObject({ userId: w.member.userId });
});

test("with the cache on, one revoked session does not cut the member's others", async () => {
  const w = await cachedWorld();
  await Bun.sleep(5);
  const other = await w.member.post("/sign-in/email", {
    email: "plain@example.test",
    password: "Password123!",
  });
  const otherHeaders = new Headers({ cookie: cookieOf(other) });
  const sessions = w.ctx.sqlite
    .prepare<{ id: number }, [number]>("SELECT id FROM auth_session WHERE user_id = ?1 ORDER BY id")
    .all(w.member.userId);
  await w.run("users.adminRevokeSessions", { sessionId: sessions[0]!.id });
  expect((await resolveActor(w.ctx, otherHeaders)).actor).toMatchObject({ kind: "user" });
});

test("with the cache on, an administrator's new password cuts the member's cached cookie", async () => {
  const w = await cachedWorld();
  await w.run("users.adminUpdateIdentity", {
    actorPassword: "Password123!",
    password: "Brand-new-secret-1",
  });
  await expect(resolveActor(w.ctx, w.headers)).rejects.toBeInstanceOf(UnauthenticatedError);
});

test("with the cache on, a ban and an erasure cut the member's cached cookie", async () => {
  const banned = await cachedWorld();
  await banned.run("bans.create", { reason: "Spam", expiresAt: null });
  await expect(resolveActor(banned.ctx, banned.headers)).rejects.toBeDefined();
  // The ban is lifted: the old cookie stays dead, the member signs in again.
  const [ban] = banned.ctx.sqlite.prepare<{ id: number }, []>("SELECT id FROM bans").all();
  const admin = banned.admin;
  await execute(banned.ctx, getOperation("bans.lift"), admin, { banId: ban!.id });
  await expect(resolveActor(banned.ctx, banned.headers)).rejects.toBeInstanceOf(
    UnauthenticatedError,
  );
  const erased = await cachedWorld();
  await erased.run("users.adminErase", { actorPassword: "Password123!", reason: "Forget" });
  await expect(resolveActor(erased.ctx, erased.headers)).rejects.toBeDefined();
});
