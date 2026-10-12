import { expect, test } from "bun:test";
import { createTestContext, insertUser } from "@sermo/core/testing";
import { ForbiddenError, UnauthenticatedError } from "../../errors";
import { registerEmailJobs } from "../email";
import { registerAccountEmailJobs } from "../email/account";
import { runDueJobs } from "../jobs/queue";
import { getAuth, resolveActor, revokeUserCredentials } from "./index";

type TestCtx = ReturnType<typeof createTestContext>;
const ORIGIN = "http://localhost:3000";

function withMail(ctx: TestCtx) {
  const capture = registerEmailJobs(
    ctx,
    { driver: "capture", sender: "forum@example.test" },
    { defaults: {}, securityTypes: new Set() },
  )!;
  registerAccountEmailJobs(ctx);
  return capture;
}

function cookieOf(response: Response): string {
  return response.headers
    .getSetCookie()
    .filter((value) => !/max-age=0/i.test(value))
    .map((value) => value.split(";")[0])
    .join("; ");
}

function client(ctx: TestCtx, ip: string) {
  const send = (path: string, init: RequestInit, cookie?: string) =>
    getAuth(ctx).handler(
      new Request(`${ORIGIN}${path}`, {
        ...init,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          "x-sermo-client-ip": ip,
          ...(cookie ? { cookie } : {}),
        },
      }),
    );
  return {
    post: (path: string, body: unknown, cookie?: string) =>
      send(
        `/api/auth${path}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", origin: ORIGIN },
          body: JSON.stringify(body),
        },
        cookie,
      ),
    follow: (text: string, cookie?: string) => {
      const url = new URL(text.match(/https?:\/\/[^\s]+/)![0]);
      return send(`${url.pathname}${url.search}`, {}, cookie);
    },
  };
}

function emailOf(ctx: TestCtx, userId: number): string | undefined {
  return ctx.sqlite
    .prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1")
    .get(userId)?.email;
}

function sessionCount(ctx: TestCtx, userId: number): number {
  return ctx.sqlite
    .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM auth_session WHERE user_id = ?1")
    .get(userId)!.n;
}

async function register(
  http: ReturnType<typeof client>,
  username: string,
  email: string,
): Promise<{ userId: number; cookie: string }> {
  const response = await http.post("/sign-up/email", {
    name: username,
    username,
    email,
    password: "Password123!",
  });
  expect(response.status).toBe(200);
  const userId = Number(((await response.json()) as { user: { id: string } }).user.id);
  return { userId, cookie: cookieOf(response) };
}

test("a used change-email link cannot move another account that later takes the old address", async () => {
  const ctx = createTestContext();
  const capture = withMail(ctx);
  const http = client(ctx, "192.0.2.50");
  const first = await register(http, "First", "a@example.test");
  const linkTo = async (address: string) => {
    await runDueJobs(ctx);
    return capture.messages.findLast(
      (message) => message.to === address && /verify-email/.test(message.text),
    )!.text;
  };

  expect(
    (await http.post("/change-email", { newEmail: "b@example.test" }, first.cookie)).status,
  ).toBe(200);
  const link = await linkTo("b@example.test");
  expect([200, 302]).toContain((await http.follow(link, first.cookie)).status);
  expect(emailOf(ctx, first.userId)).toBe("b@example.test");

  expect(
    (await http.post("/change-email", { newEmail: "c@example.test" }, first.cookie)).status,
  ).toBe(200);
  const second = await linkTo("c@example.test");
  expect([200, 302]).toContain((await http.follow(second, first.cookie)).status);
  expect(emailOf(ctx, first.userId)).toBe("c@example.test");

  const other = await register(client(ctx, "192.0.2.51"), "Other", "a@example.test");
  const sessionsBefore = sessionCount(ctx, other.userId);
  const replay = await http.follow(link);
  expect(replay.status).toBe(401);
  expect(((await replay.json()) as { code: string }).code).toBe("INVALID_TOKEN");
  expect(replay.headers.getSetCookie().some((value) => /session_token=[^;]/.test(value))).toBe(
    false,
  );
  expect(emailOf(ctx, other.userId)).toBe("a@example.test");
  expect(sessionCount(ctx, other.userId)).toBe(sessionsBefore);
  // The link is spent for its own account too.
  expect((await http.follow(second, first.cookie)).status).toBe(401);
  expect(emailOf(ctx, first.userId)).toBe("c@example.test");
});

test("an unused change-email link only ever applies to the account that requested it", async () => {
  const ctx = createTestContext();
  const capture = withMail(ctx);
  const http = client(ctx, "192.0.2.52");
  const first = await register(http, "First", "a@example.test");
  await http.post("/change-email", { newEmail: "b@example.test" }, first.cookie);
  await runDueJobs(ctx);
  const stale = capture.messages.find((message) => message.to === "b@example.test")!.text;
  // The requester moves elsewhere without using the first link, freeing the old address.
  await http.post("/change-email", { newEmail: "c@example.test" }, first.cookie);
  await runDueJobs(ctx);
  const used = capture.messages.find((message) => message.to === "c@example.test")!.text;
  expect([200, 302]).toContain((await http.follow(used, first.cookie)).status);
  const other = await register(client(ctx, "192.0.2.53"), "Other", "a@example.test");

  const sessionsBefore = sessionCount(ctx, other.userId);
  const rejected = await http.follow(stale);
  expect(rejected.status).toBe(401);
  expect(await rejected.json()).toMatchObject({ code: "INVALID_TOKEN" });
  expect(rejected.headers.getSetCookie().some((value) => /session_token=[^;]/.test(value))).toBe(
    false,
  );
  expect(sessionCount(ctx, other.userId)).toBe(sessionsBefore);
  expect(emailOf(ctx, other.userId)).toBe("a@example.test");
  expect(emailOf(ctx, first.userId)).toBe("c@example.test");
});

test("a consumed change-email link stays spent after its owner returns to the original address", async () => {
  const ctx = createTestContext();
  const capture = withMail(ctx);
  const http = client(ctx, "192.0.2.76");
  const owner = await register(http, "Owner", "a@example.test");
  const changeTo = async (email: string) => {
    expect((await http.post("/change-email", { newEmail: email }, owner.cookie)).status).toBe(200);
    await runDueJobs(ctx);
    const link = capture.messages.findLast(
      (message) => message.to === email && /verify-email/.test(message.text),
    )!.text;
    expect([200, 302]).toContain((await http.follow(link, owner.cookie)).status);
    return link;
  };
  const spent = await changeTo("b@example.test");
  await changeTo("a@example.test");
  const sessionsBefore = sessionCount(ctx, owner.userId);
  const replay = await http.follow(spent);
  expect(replay.status).toBe(401);
  expect(await replay.json()).toMatchObject({ code: "INVALID_TOKEN" });
  expect(replay.headers.getSetCookie()).toEqual([]);
  expect(emailOf(ctx, owner.userId)).toBe("a@example.test");
  expect(sessionCount(ctx, owner.userId)).toBe(sessionsBefore);
});

test("a revoked session cannot renew its cookie cache through Better Auth's endpoints", async () => {
  const ctx = createTestContext();
  const http = client(ctx, "192.0.2.54");
  const { userId, cookie } = await register(http, "Cached", "cached@example.test");
  expect(cookie).toContain("sermo.session_data=");
  await revokeUserCredentials(ctx, userId);
  expect(sessionCount(ctx, userId)).toBe(0);

  const update = await http.post("/update-user", { name: "Still here" }, cookie);
  expect(update.status).toBe(401);
  expect(update.headers.getSetCookie().some((value) => /session_data=[^;]/.test(value))).toBe(
    false,
  );
  expect(
    ctx.sqlite
      .prepare<{ name: string }, [number]>("SELECT name FROM auth_user WHERE id = ?1")
      .get(userId)?.name,
  ).toBe("Cached");
  for (const path of ["/list-sessions", "/api-key/list"]) {
    const response = await getAuth(ctx).handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        headers: { cookie, "x-sermo-client-ip": "192.0.2.54" },
      }),
    );
    expect(response.status).toBe(401);
  }
  // The same holds for direct calls that do not go through the HTTP handler.
  await expect(
    getAuth(ctx).api.updateUser({ headers: new Headers({ cookie }), body: { name: "Direct" } }),
  ).rejects.toMatchObject({ statusCode: 401 });
  // REST: the cached session is served without renewing the cache, and stops with the cache.
  const cached = await resolveActor(ctx, new Headers({ cookie }));
  expect(cached.actor.kind).toBe("user");
  expect(cached.setCookies.some((value) => /session_data=[^;]/.test(value))).toBe(false);
  const tokenOnly = cookie.split("; ").find((part) => part.startsWith("sermo.session_token="))!;
  await expect(resolveActor(ctx, new Headers({ cookie: tokenOnly }))).rejects.toBeInstanceOf(
    UnauthenticatedError,
  );
});

test("a live session still updates its profile and gets a fresh cache cookie", async () => {
  const ctx = createTestContext();
  const http = client(ctx, "192.0.2.55");
  const { userId, cookie } = await register(http, "Live", "live@example.test");
  const update = await http.post("/update-user", { name: "Renamed" }, cookie);
  expect(update.status).toBe(200);
  expect(update.headers.getSetCookie().some((value) => /session_data=[^;]/.test(value))).toBe(true);
  expect(
    ctx.sqlite
      .prepare<{ name: string }, [number]>("SELECT name FROM auth_user WHERE id = ?1")
      .get(userId)?.name,
  ).toBe("Renamed");
});

test("a banned member cannot sign in or change their identity through Better Auth", async () => {
  const ctx = createTestContext();
  const http = client(ctx, "192.0.2.56");
  const { userId, cookie } = await register(http, "Banned", "banned@example.test");
  const usernameOf = () =>
    ctx.sqlite
      .prepare<{ username: string }, [number]>("SELECT username FROM users WHERE id = ?1")
      .get(userId)?.username;

  // A ban that left the session row in place: the session must not act.
  ctx.sqlite.prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1").run(userId);
  const rename = await http.post("/update-user", { username: "Renamed" }, cookie);
  expect(rename.status).toBe(403);
  expect(await rename.json()).toMatchObject({
    code: "ACCOUNT_BANNED",
    message: "This account is banned.",
  });
  expect(usernameOf()).toBe("Banned");
  const deniedKey = await http.post("/api-key/create", { name: "key" }, cookie);
  expect(deniedKey.status).toBe(403);
  expect(await deniedKey.json()).toMatchObject({ code: "ACCOUNT_BANNED" });
  await expect(resolveActor(ctx, new Headers({ cookie }))).rejects.toBeInstanceOf(ForbiddenError);
  // Signing out stays possible.
  expect((await http.post("/sign-out", {}, cookie)).status).toBe(200);

  await revokeUserCredentials(ctx, userId);
  for (const [path, body] of [
    ["/sign-in/email", { email: "banned@example.test", password: "Password123!" }],
    ["/sign-in/username", { username: "Banned", password: "Password123!" }],
  ] as const) {
    const response = await client(ctx, `192.0.2.${path.length + 100}`).post(path, body);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "ACCOUNT_BANNED" });
    expect(response.headers.getSetCookie().some((value) => /session_token=[^;]/.test(value))).toBe(
      false,
    );
  }
  expect(sessionCount(ctx, userId)).toBe(0);

  // A temporary ban blocks while it runs and stops blocking once it has expired.
  ctx.sqlite
    .prepare("UPDATE users SET banned_permanently = 0, banned_until = ?1 WHERE id = ?2")
    .run(ctx.now() + 60_000, userId);
  const signIn = () =>
    client(ctx, "192.0.2.57").post("/sign-in/email", {
      email: "banned@example.test",
      password: "Password123!",
    });
  expect((await signIn()).status).toBe(403);
  ctx.sqlite.prepare("UPDATE users SET banned_until = ?1 WHERE id = ?2").run(ctx.now() - 1, userId);
  const allowed = await signIn();
  expect(allowed.status).toBe(200);
  // The session works again; a username changes only through users.changeUsername.
  expect((await http.post("/update-user", { name: "Returned" }, cookieOf(allowed))).status).toBe(
    200,
  );
  expect(usernameOf()).toBe("Banned");
});

test("password reset requests without redirectTo are refused before anything is created", async () => {
  const ctx = createTestContext();
  const capture = withMail(ctx);
  const http = client(ctx, "192.0.2.58");
  await register(http, "Reset", "reset@example.test");
  await runDueJobs(ctx);
  const mailBefore = capture.messages.length;
  const tokens = () =>
    ctx.sqlite
      .query<{ n: number }, []>(
        "SELECT count(*) AS n FROM auth_verification WHERE identifier LIKE 'reset-password:%'",
      )
      .get()!.n;
  const outcomes: string[] = [];
  for (const email of ["reset@example.test", "nobody@example.test"])
    for (const extra of [{}, { redirectTo: "" }, { redirectTo: null }]) {
      const response = await client(ctx, `192.0.2.${60 + outcomes.length}`).post(
        "/request-password-reset",
        { email, ...extra },
      );
      outcomes.push(`${response.status} ${await response.text()}`);
    }
  expect(new Set(outcomes).size).toBe(1);
  expect(outcomes[0]).toStartWith("400 ");
  expect(outcomes[0]).toContain("REDIRECT_REQUIRED");
  // HTTP origin validation rejects whitespace URLs before the hook; direct calls still need
  // the hook's nonempty check.
  await expect(
    getAuth(ctx).api.requestPasswordReset({
      body: { email: "reset@example.test", redirectTo: " \t " },
    }),
  ).rejects.toMatchObject({ statusCode: 400, body: { code: "REDIRECT_REQUIRED" } });
  await runDueJobs(ctx);
  expect(capture.messages).toHaveLength(mailBefore);
  expect(tokens()).toBe(0);

  const valid = await http.post("/request-password-reset", {
    email: "reset@example.test",
    redirectTo: `${ORIGIN}/reset-password`,
  });
  expect(valid.status).toBe(200);
  await runDueJobs(ctx);
  expect(capture.messages).toHaveLength(mailBefore + 1);
  expect(tokens()).toBe(1);
});

test("usernames whose lowercase form is not a valid username are refused", async () => {
  const ctx = createTestContext();
  const auth = getAuth(ctx);
  const body = (username: string, email: string) => ({
    name: username,
    username,
    email,
    password: "password123",
  });
  // "İ" lowercases to "i" plus a combining dot, which the username rule does not allow.
  await expect(
    auth.api.signUpEmail({ body: body("İpek", "ipek@example.test") }),
  ).rejects.toMatchObject({ body: { code: "INVALID_USERNAME" } });
  expect(ctx.sqlite.query<{ n: number }, []>("SELECT count(*) AS n FROM auth_user").get()?.n).toBe(
    0,
  );

  const signedUp = await auth.api.signUpEmail({ body: body("Éloise", "eloise@example.test") });
  const normalized = (signedUp.user as { username?: string }).username;
  expect(normalized).toBe("éloise");
  for (const username of ["Éloise", normalized!, "ÉLOISE"]) {
    const signedIn = await auth.api.signInUsername({ body: { username, password: "password123" } });
    expect(signedIn?.user.id).toBe(signedUp.user.id);
  }
});

test("authenticated username changes reject names whose lowercase form is invalid", async () => {
  const ctx = createTestContext();
  const auth = getAuth(ctx);
  await auth.api.signUpEmail({
    body: { name: "ipek", username: "ipek", email: "plain@example.test", password: "password123" },
  });
  const signedIn = await client(ctx, "192.0.2.70").post("/sign-in/username", {
    username: "ipek",
    password: "password123",
  });
  expect(signedIn.status).toBe(200);
  const cookie = cookieOf(signedIn);
  expect(cookie).toContain("sermo.session_token=");
  await expect(
    auth.api.updateUser({
      headers: new Headers({ cookie }),
      body: { name: "Authenticated profile update" },
    }),
  ).resolves.toMatchObject({ status: true });
  await expect(
    auth.api.updateUser({
      headers: new Headers({ cookie }),
      body: { username: "İpek" },
    }),
  ).rejects.toMatchObject({ statusCode: 400, body: { code: "INVALID_USERNAME" } });
  expect(ctx.sqlite.query<{ username: string }, []>("SELECT username FROM users").all()).toEqual([
    { username: "ipek" },
  ]);
  expect(
    ctx.sqlite.query<{ username: string }, []>("SELECT username FROM auth_user").all(),
  ).toEqual([{ username: "ipek" }]);
});

test("username availability applies the rules for new usernames", async () => {
  const auth = getAuth(createTestContext());
  await expect(auth.api.isUsernameAvailable({ body: { username: "İpek" } })).rejects.toMatchObject({
    statusCode: 422,
    body: { code: "INVALID_USERNAME" },
  });
  await expect(auth.api.isUsernameAvailable({ body: { username: "Éloise" } })).resolves.toEqual({
    available: true,
  });
});

test("legacy Unicode usernames remain usable for username sign-in", async () => {
  const ctx = createTestContext();
  // Older registrations stored the display spelling and its lowercase lookup key separately.
  const legacy = insertUser(ctx, { username: "İpek", email: "legacy@example.test" });
  const password = "Password123!";
  const hash = await Bun.password.hash(password, ctx.config.passwordHash);
  ctx.sqlite
    .prepare(
      "INSERT INTO auth_account (account_id, provider_id, user_id, password, created_at, updated_at) " +
        "VALUES (?1, 'credential', ?2, ?3, ?4, ?4)",
    )
    .run(String(legacy.id), legacy.id, hash, ctx.now());
  expect(
    ctx.sqlite
      .prepare<{ username: string; display_username: string }, [number]>(
        "SELECT username, display_username FROM auth_user WHERE id = ?1",
      )
      .get(legacy.id),
  ).toEqual({ username: "i\u0307pek", display_username: "İpek" });

  for (const [index, username] of ["İpek", "İPEK"].entries()) {
    const response = await client(ctx, `192.0.2.${71 + index}`).post("/sign-in/username", {
      username,
      password,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      user: { id: String(legacy.id), username: "i\u0307pek", displayUsername: "İpek" },
    });
    expect(
      (await resolveActor(ctx, new Headers({ cookie: cookieOf(response) }))).actor,
    ).toMatchObject({
      kind: "user",
      userId: legacy.id,
    });
    expect(
      (
        await client(ctx, `192.0.2.${74 + index}`).post(
          "/update-user",
          { name: "Existing member" },
          cookieOf(response),
        )
      ).status,
    ).toBe(200);
  }
  const sessionsBefore = sessionCount(ctx, legacy.id);
  const wrongPassword = await client(ctx, "192.0.2.73").post("/sign-in/username", {
    username: "İpek",
    password: "WrongPassword!",
  });
  expect(wrongPassword.status).toBe(401);
  expect(await wrongPassword.json()).toMatchObject({ code: "INVALID_USERNAME_OR_PASSWORD" });
  expect(cookieOf(wrongPassword)).toBe("");
  expect(sessionCount(ctx, legacy.id)).toBe(sessionsBefore);
});
