import { expect, test } from "bun:test";
import { createContext } from "../../context";
import { UnauthenticatedError } from "../../errors";
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

async function signUpAndIn(ctx: ReturnType<typeof contextWith>) {
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
    name: "Plain",
    username: "Plain",
    email: "plain@example.test",
    password: "Password123!",
  });
  expect(up.status).toBe(200);
  const userId = Number(((await up.json()) as { user: { id: string } }).user.id);
  const inResponse = await post("/sign-in/email", {
    email: "plain@example.test",
    password: "Password123!",
  });
  expect(inResponse.status).toBe(200);
  const cookies = inResponse.headers.getSetCookie().map((value) => value.split(";")[0]!);
  return {
    userId,
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
  const { userId, token } = await signUpAndIn(ctx);
  const headers = new Headers({ cookie: token });
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
