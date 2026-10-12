import { afterEach, mock, test } from "bun:test";
import assert from "node:assert/strict";

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
mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => incoming,
  cookies: async () => ({
    set: (cookie: Record<string, unknown>) => written.push(cookie),
  }),
}));

const { signInWithUsername, signInWithEmail, signUp, signOut } = await import(
  "./auth"
);

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
  assert.deepEqual(result, { ok: true, code: undefined, signedIn: true });
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
