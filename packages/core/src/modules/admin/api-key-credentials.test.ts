import { afterEach, describe, expect, test } from "bun:test";
import { getAuth } from "../auth";
import { accounts, closeAll, PASSWORD } from "./fixtures.test";

afterEach(closeAll);

const ORIGIN = "http://localhost:3000";
// Better Auth keeps its request counts per address across contexts, so addresses are not reused.
let ip = 1;

async function world() {
  const w = await accounts({ mail: true });
  const founder = await w.register("Founder", 4);
  const target = await w.register("Target");
  const post = (path: string, body: unknown, cookie?: string) =>
    getAuth(w.ctx).handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          "x-sermo-client-ip": `192.0.2.${ip++}`,
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const cookieOf = (response: Response) =>
    response.headers
      .getSetCookie()
      .filter((value) => !/max-age=0/i.test(value))
      .map((value) => value.split(";")[0])
      .join("; ");
  const login = async () =>
    cookieOf(await post("/sign-in/email", { email: "target@example.test", password: PASSWORD }));
  const keys = () =>
    w.ctx.sqlite
      .prepare<{ n: number }, [string]>(
        "SELECT count(*) AS n FROM auth_apikey WHERE reference_id = ?1",
      )
      .get(String(target.id))!.n;
  return { ...w, founder, target, post, login, keys };
}

describe("creating an API key from a session", () => {
  test("takes the member's current password; a missing or wrong one makes no key", async () => {
    const w = await world();
    const cookie = await w.login();
    const none = await w.post("/api-key/create", { name: "k" }, cookie);
    expect(none.status).toBe(400);
    expect(await none.json()).toMatchObject({ code: "PASSWORD_REQUIRED" });
    const wrong = await w.post("/api-key/create", { name: "k", password: "nope-nope-1" }, cookie);
    expect(wrong.status).toBe(403);
    expect(await wrong.json()).toMatchObject({ code: "INVALID_PASSWORD" });
    expect(w.keys()).toBe(0);
    const right = await w.post("/api-key/create", { name: "k", password: PASSWORD }, cookie);
    expect(right.status).toBe(200);
    expect(w.keys()).toBe(1);
  });

  test("shares the wrong-answer limit: five per session, then even the right one is refused", async () => {
    const w = await world();
    const cookie = await w.login();
    for (let i = 0; i < 5; i++)
      expect(
        (await w.post("/api-key/create", { name: "k", password: "nope-nope-1" }, cookie)).status,
      ).toBe(403);
    const refused = await w.post("/api-key/create", { name: "k", password: PASSWORD }, cookie);
    expect(refused.status).toBe(429);
    expect(w.keys()).toBe(0);
    // The same counts bind the administrative checks of that session.
    const other = await w.login();
    expect((await w.post("/api-key/create", { name: "k", password: PASSWORD }, other)).status).toBe(
      200,
    );
  });

  test("an in-process call for a member (no session) needs no password", async () => {
    const w = await world();
    await getAuth(w.ctx).api.createApiKey({ body: { userId: String(w.target.id), name: "k" } });
    expect(w.keys()).toBe(1);
  });
});

describe("a password change ends the member's API keys", () => {
  const withKey = async (w: Awaited<ReturnType<typeof world>>) => {
    const cookie = await w.login();
    const made = await w.post("/api-key/create", { name: "k", password: PASSWORD }, cookie);
    expect(made.status).toBe(200);
    expect(w.keys()).toBe(1);
    return cookie;
  };

  test("the member's own change of password", async () => {
    const w = await world();
    const cookie = await withKey(w);
    const changed = await w.post(
      "/change-password",
      { currentPassword: PASSWORD, newPassword: "Another-secret-9" },
      cookie,
    );
    expect(changed.status).toBe(200);
    expect(w.keys()).toBe(0);
  });

  test("a wrong current password leaves the keys", async () => {
    const w = await world();
    const cookie = await withKey(w);
    const changed = await w.post(
      "/change-password",
      { currentPassword: "nope-nope-1", newPassword: "Another-secret-9" },
      cookie,
    );
    expect(changed.status).toBe(400);
    expect(w.keys()).toBe(1);
  });

  test("a reset link", async () => {
    const w = await world();
    await withKey(w);
    const authContext = await getAuth(w.ctx).$context;
    await authContext.internalAdapter.createVerificationValue({
      identifier: "reset-password:tok",
      value: String(w.target.id),
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const reset = await w.post("/reset-password", {
      token: "tok",
      newPassword: "Another-secret-9",
    });
    expect(reset.status).toBe(200);
    expect(w.keys()).toBe(0);
  });

  test("an administrator setting the password", async () => {
    const w = await world();
    await withKey(w);
    await w.run("users.adminUpdateIdentity", w.founder.actor, {
      userId: w.target.id,
      actorPassword: PASSWORD,
      email: "moved@example.test",
    });
    expect(w.keys()).toBe(1);
    await w.run("users.adminUpdateIdentity", w.founder.actor, {
      userId: w.target.id,
      actorPassword: PASSWORD,
      password: "Brand-new-secret-1",
    });
    expect(w.keys()).toBe(0);
  });

  test("an administrator signing the member out everywhere, but not one session", async () => {
    const w = await world();
    await withKey(w);
    const session = (await w.run("users.adminSessions", w.founder.actor, { userId: w.target.id }))
      .items[0].id;
    await w.run("users.adminRevokeSessions", w.founder.actor, {
      userId: w.target.id,
      sessionId: session,
    });
    expect(w.keys()).toBe(1);
    await w.run("users.adminRevokeSessions", w.founder.actor, { userId: w.target.id });
    expect(w.keys()).toBe(0);
  });
});
