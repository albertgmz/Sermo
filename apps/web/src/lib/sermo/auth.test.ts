import { afterEach, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const incoming = new Headers({
  cookie: "theme=dark; sermo.session_token=old",
  "user-agent": "agent/1",
  "x-forwarded-for": "203.0.113.9, 198.51.100.4",
});
const written: Record<string, unknown>[] = [];
// While a page renders, Next's cookie store throws on a write; in an action it takes it.
let renderTime = false;
mock.module("server-only", () => ({}));
// Bun applies module mocks to the whole run, so these match the ones in the site test.
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => incoming,
  cookies: async () => ({
    set: (cookie: Record<string, unknown>) => {
      if (renderTime)
        throw new Error("Cookies can only be modified in an action");
      written.push(cookie);
    },
  }),
}));

const {
  changePassword,
  getCurrentAccount,
  listSessions,
  mailAvailable,
  requestEmailChange,
  requestPasswordReset,
  resetPassword,
  revokeOtherSessions,
  revokeSession,
  sendVerificationEmail,
  signInWithUsername,
  signInWithEmail,
  signUp,
  signOut,
} = await import("./auth");

type Sent = { url: string; method?: string; body?: unknown; headers: Headers };

function backend(response: Response) {
  const seen: Sent[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen.push({
      url,
      method: init.method,
      body: init.body,
      headers: new Headers(init.headers),
    });
    return response;
  }) as unknown as typeof fetch;
  return seen;
}

function answer(
  cookies: string[],
  init: { status?: number; body?: unknown } = {},
) {
  const headers = new Headers();
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(init.body ?? {}), {
    status: init.status ?? 200,
    headers,
  });
}

test("every cookie of the answer is written with its attributes", async () => {
  written.length = 0;
  backend(
    answer([
      "sermo.session_token=tok; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax",
      "sermo.session_data=data; Path=/; Secure; SameSite=Strict",
    ]),
  );
  const result = await signInWithUsername("ann", "secret", true);
  // `cookie` is what a request made with the answer's cookies would carry.
  assert.deepEqual(result, {
    ok: true,
    code: undefined,
    signedIn: true,
    cookie: "sermo.session_token=tok; sermo.session_data=data",
  });
  assert.deepEqual(written, [
    {
      name: "sermo.session_token",
      value: "tok",
      maxAge: 604800,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    },
    {
      name: "sermo.session_data",
      value: "data",
      path: "/",
      secure: true,
      sameSite: "strict",
    },
  ]);
  assert.equal("maxAge" in written[1], false);
});

test("a deletion cookie is written and does not sign the visitor in", async () => {
  written.length = 0;
  backend(answer(["sermo.session_token=; Max-Age=0; Path=/"]));
  const result = await signOut();
  assert.equal(result.signedIn, false);
  assert.deepEqual(written, [
    { name: "sermo.session_token", value: "", maxAge: 0, path: "/" },
  ]);
});

test("signedIn needs a non-empty session token cookie", async () => {
  backend(answer(["sermo.session_data=x; Path=/"]));
  assert.equal(
    (await signInWithEmail("a@example.test", "pw", false)).signedIn,
    false,
  );
  backend(answer(["sermo.session_token=; Path=/"]));
  assert.equal(
    (await signInWithEmail("a@example.test", "pw", false)).signedIn,
    false,
  );
  backend(answer(["__Secure-sermo.session_token=tok; Path=/; Secure"]));
  assert.equal(
    (await signInWithEmail("a@example.test", "pw", false)).signedIn,
    true,
  );
  backend(answer([]));
  const registered = await signUp({
    username: "u",
    email: "a@example.test",
    password: "pw",
    acceptTerms: true,
  });
  assert.equal(registered.signedIn, false);
});

test("cookies of a failed answer are written too, with its error code", async () => {
  written.length = 0;
  backend(
    answer(["sermo.captcha=1; Path=/"], {
      status: 401,
      body: { code: "INVALID_USERNAME_OR_PASSWORD" },
    }),
  );
  const result = await signInWithUsername("ann", "wrong", false);
  assert.deepEqual(result, {
    ok: false,
    code: "INVALID_USERNAME_OR_PASSWORD",
    signedIn: false,
    cookie: "sermo.captcha=1",
  });
  assert.equal(written.length, 1);
  assert.equal(written[0].name, "sermo.captcha");
});

test("a 429 answer is RATE_LIMITED, whatever the body says", async () => {
  backend(answer([], { status: 429, body: { code: "TOO_MANY" } }));
  assert.equal(
    (await signInWithUsername("ann", "pw", false)).code,
    "RATE_LIMITED",
  );
  backend(new Response("slow down", { status: 429 }));
  assert.equal(
    (await signInWithUsername("ann", "pw", false)).code,
    "RATE_LIMITED",
  );
});

test("a failure without a readable code has none", async () => {
  backend(new Response("<html>", { status: 502 }));
  assert.deepEqual(await signInWithUsername("ann", "pw", false), {
    ok: false,
    code: undefined,
    signedIn: false,
    cookie: "",
  });
});

test("the request carries the forwarded cookie, origin, user agent and client IP", async () => {
  const seen = backend(answer([]));
  await signInWithUsername("ann", "pw", true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "http://127.0.0.1:8787/api/auth/sign-in/username");
  assert.equal(seen[0].method, "POST");
  assert.deepEqual(JSON.parse(String(seen[0].body)), {
    username: "ann",
    password: "pw",
    rememberMe: true,
  });
  assert.equal(seen[0].headers.get("cookie"), "sermo.session_token=old");
  assert.equal(seen[0].headers.get("origin"), "http://localhost:3000");
  assert.equal(seen[0].headers.get("user-agent"), "agent/1");
  assert.equal(seen[0].headers.get("x-forwarded-for"), "198.51.100.4");
  assert.equal(seen[0].headers.get("content-type"), "application/json");
});

test("sign-out sends no body", async () => {
  const seen = backend(answer([]));
  await signOut();
  assert.equal(seen[0].url, "http://127.0.0.1:8787/api/auth/sign-out");
  assert.equal(seen[0].body, undefined);
  assert.equal(seen[0].headers.get("content-type"), null);
});

const sessionRow = {
  id: "7",
  token: "secret-token",
  createdAt: "2026-10-01T10:00:00.000Z",
  expiresAt: "2026-10-31T10:00:00.000Z",
  ipAddress: "203.0.113.9",
  userAgent: "agent/1",
  userId: "3",
  updatedAt: "2026-10-01T10:00:00.000Z",
};

test("sessions are listed with a GET and keep only the fields the page needs", async () => {
  const seen = backend(
    answer([], {
      body: [
        sessionRow,
        { ...sessionRow, id: "8", ipAddress: null, userAgent: undefined },
      ],
    }),
  );
  const result = await listSessions();
  assert.equal(seen[0].url, "http://127.0.0.1:8787/api/auth/list-sessions");
  assert.equal(seen[0].method, "GET");
  assert.equal(seen[0].body, undefined);
  assert.equal(seen[0].headers.get("cookie"), "sermo.session_token=old");
  assert.equal(result.ok, true);
  assert.deepEqual(result.sessions, [
    {
      id: "7",
      token: "secret-token",
      createdAt: sessionRow.createdAt,
      expiresAt: sessionRow.expiresAt,
      ipAddress: "203.0.113.9",
      userAgent: "agent/1",
    },
    {
      id: "8",
      token: "secret-token",
      createdAt: sessionRow.createdAt,
      expiresAt: sessionRow.expiresAt,
      ipAddress: null,
      userAgent: null,
    },
  ]);
});

test("a refused listing has no sessions and carries the error code", async () => {
  backend(answer([], { status: 403, body: { code: "SESSION_NOT_FRESH" } }));
  const result = await listSessions();
  assert.equal(result.ok, false);
  assert.equal(result.code, "SESSION_NOT_FRESH");
  assert.deepEqual(result.sessions, []);
});

test("the current account is read from the database, not the cookie cache", async () => {
  const seen = backend(
    answer([], {
      body: {
        session: { id: "7", token: "secret-token" },
        user: { email: "ann@example.test", emailVerified: true },
      },
    }),
  );
  assert.deepEqual(await getCurrentAccount(), {
    sessionId: "7",
    email: "ann@example.test",
    emailVerified: true,
  });
  assert.equal(
    seen[0].url,
    "http://127.0.0.1:8787/api/auth/get-session?disableCookieCache=true",
  );
  assert.equal(seen[0].method, "GET");
});

test("no session is no account", async () => {
  backend(new Response("null", { status: 200 }));
  assert.equal(await getCurrentAccount(), null);
  backend(answer([], { status: 401, body: { code: "UNAUTHORIZED" } }));
  assert.equal(await getCurrentAccount(), null);
});

test("reads made while a page renders ignore the cookies of the answer", async () => {
  renderTime = true;
  try {
    written.length = 0;
    backend(
      answer(["sermo.session_data=fresh; Path=/; HttpOnly"], {
        body: {
          session: { id: "7", token: "secret-token" },
          user: { email: "ann@example.test", emailVerified: true },
        },
      }),
    );
    assert.equal((await getCurrentAccount())?.sessionId, "7");
    backend(
      answer(["sermo.session_data=fresh; Path=/; HttpOnly"], {
        body: [sessionRow],
      }),
    );
    assert.equal((await listSessions()).sessions.length, 1);
    // A dead cookie is expired by the backend; the read still reports it as no session.
    const dead = () =>
      backend(
        answer(["sermo.session_token=; Max-Age=0; Path=/"], {
          status: 401,
          body: { code: "UNAUTHORIZED" },
        }),
      );
    dead();
    assert.equal(await getCurrentAccount(), null);
    dead();
    assert.equal((await listSessions()).code, "UNAUTHORIZED");
    assert.deepEqual(written, []);
  } finally {
    renderTime = false;
  }
});

test("a write the cookie store refuses in an action is not swallowed", async () => {
  renderTime = true;
  try {
    backend(answer(["sermo.session_token=tok; Path=/"]));
    await assert.rejects(
      () => signInWithUsername("ann", "pw", false),
      /Cookies/,
    );
  } finally {
    renderTime = false;
  }
});

test("revoking sends the token of one session, or nothing for the others", async () => {
  let seen = backend(answer([], { body: { status: true } }));
  assert.equal((await revokeSession("secret-token")).ok, true);
  assert.equal(seen[0].url, "http://127.0.0.1:8787/api/auth/revoke-session");
  assert.equal(seen[0].method, "POST");
  assert.deepEqual(JSON.parse(String(seen[0].body)), { token: "secret-token" });
  seen = backend(answer([], { body: { status: true } }));
  assert.equal((await revokeOtherSessions()).ok, true);
  assert.equal(
    seen[0].url,
    "http://127.0.0.1:8787/api/auth/revoke-other-sessions",
  );
  assert.deepEqual(JSON.parse(String(seen[0].body)), {});
});

test("changing the password sends both passwords and delivers the new session cookie", async () => {
  written.length = 0;
  const seen = backend(
    answer(["sermo.session_token=fresh; Max-Age=604800; Path=/; HttpOnly"], {
      body: { token: "fresh", user: {} },
    }),
  );
  const result = await changePassword({
    currentPassword: "old-password",
    newPassword: "new-password",
    revokeOtherSessions: true,
  });
  assert.deepEqual(result, {
    ok: true,
    code: undefined,
    signedIn: true,
    cookie: "sermo.session_token=fresh",
  });
  assert.equal(seen[0].url, "http://127.0.0.1:8787/api/auth/change-password");
  assert.deepEqual(JSON.parse(String(seen[0].body)), {
    currentPassword: "old-password",
    newPassword: "new-password",
    revokeOtherSessions: true,
  });
  assert.equal(written[0].value, "fresh");
});

test("a refused password change keeps its error code", async () => {
  backend(answer([], { status: 400, body: { code: "INVALID_PASSWORD" } }));
  const result = await changePassword({
    currentPassword: "wrong",
    newPassword: "new-password",
    revokeOtherSessions: false,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, "INVALID_PASSWORD");
});

test("the email calls ask for the link to come back to this site", async () => {
  let seen = backend(answer([], { body: { status: true } }));
  await requestEmailChange("new@example.test");
  assert.equal(seen[0].url, "http://127.0.0.1:8787/api/auth/change-email");
  assert.deepEqual(JSON.parse(String(seen[0].body)), {
    newEmail: "new@example.test",
    callbackURL: "http://localhost:3000/verify-email?done=1",
  });
  seen = backend(answer([], { body: { status: true } }));
  await sendVerificationEmail("ann@example.test");
  assert.equal(
    seen[0].url,
    "http://127.0.0.1:8787/api/auth/send-verification-email",
  );
  assert.deepEqual(JSON.parse(String(seen[0].body)), {
    email: "ann@example.test",
    callbackURL: "http://localhost:3000/verify-email?done=1",
  });
  seen = backend(answer([], { body: { status: true } }));
  await requestPasswordReset("ann@example.test");
  assert.equal(
    seen[0].url,
    "http://127.0.0.1:8787/api/auth/request-password-reset",
  );
  assert.deepEqual(JSON.parse(String(seen[0].body)), {
    email: "ann@example.test",
    redirectTo: "http://localhost:3000/reset-password",
  });
  seen = backend(answer([], { body: { status: true } }));
  await signUp({
    username: "ann",
    email: "ann@example.test",
    password: "pw",
    acceptTerms: true,
  });
  assert.equal(
    JSON.parse(String(seen[0].body)).callbackURL,
    "http://localhost:3000/verify-email?done=1",
  );
  assert.equal(JSON.parse(String(seen[0].body)).acceptTerms, true);
});

test("the reset sends the token with the new password", async () => {
  const seen = backend(answer([], { body: { status: true } }));
  assert.equal((await resetPassword("abc", "new-password")).ok, true);
  assert.equal(seen[0].url, "http://127.0.0.1:8787/api/auth/reset-password");
  assert.deepEqual(JSON.parse(String(seen[0].body)), {
    token: "abc",
    newPassword: "new-password",
  });
});

test("mail is available unless the backend says verification email is not enabled", async () => {
  const seen = backend(
    answer([], {
      status: 400,
      body: { code: "VERIFICATION_EMAIL_NOT_ENABLED" },
    }),
  );
  assert.equal(await mailAvailable(), false);
  assert.equal(
    seen[0].url,
    "http://127.0.0.1:8787/api/auth/send-verification-email",
  );
  assert.equal(seen[0].headers.get("cookie"), null);
  backend(answer([], { body: { status: true } }));
  assert.equal(await mailAvailable(), true);
  backend(answer([], { status: 429, body: { code: "TOO_MANY_REQUESTS" } }));
  assert.equal(await mailAvailable(), true);
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  assert.equal(await mailAvailable(), true);
});

test("the answer about mail is kept for five minutes, not longer", () => {
  const source = readFileSync(`${import.meta.dir}/auth.ts`, "utf8");
  assert.ok(
    source.includes("cacheLife({ stale: 60, revalidate: 300, expire: 600 })"),
  );
  assert.ok(!source.includes("revalidate: 1800"));
});
