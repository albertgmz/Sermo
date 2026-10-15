import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";

const realFetch = globalThis.fetch;
const written: Record<string, unknown>[] = [];
// The cookies the visitor came with, and the names an action removed.
const jar = new Map<string, string>();
const removed: string[] = [];
const bodies: Record<string, unknown>[] = [];

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    set: (cookie: Record<string, unknown>) => written.push(cookie),
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name) } : undefined,
    has: (name: string) => jar.has(name),
    delete: (name: string) => removed.push(name),
    toString: () => "",
  }),
}));

const { login, register } = await import("./actions");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
beforeEach(() => {
  written.length = 0;
  removed.length = 0;
  bodies.length = 0;
  jar.clear();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function backend(response: () => Response) {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    asked.push(url);
    bodies.push(typeof init?.body === "string" ? JSON.parse(init.body) : {});
    return response();
  }) as unknown as typeof fetch;
  return asked;
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

test("wrong credentials come back as the form's message with the username kept, and no cookie", async () => {
  const asked = backend(() =>
    Response.json({ code: "INVALID_USERNAME_OR_PASSWORD" }, { status: 401 }),
  );
  const state = await login(
    { error: "", username: "" },
    form({ username: "ann", password: "wrong" }),
  );
  expect(state).toEqual({
    error: messages.auth.actions.errors.invalidCredentials,
    username: "ann",
  });
  expect(asked).toEqual(["http://127.0.0.1:8787/api/auth/sign-in/username"]);
  expect(written).toEqual([]);
});

test("a missing field is refused without asking the backend", async () => {
  const asked = backend(() => Response.json({}));
  const state = await login(
    { error: "", username: "" },
    form({ username: "ann", password: "" }),
  );
  expect(state.error).toBe(messages.auth.actions.errors.invalidCredentials);
  expect(asked).toEqual([]);
});

test("signing in delivers the session cookie and goes back to the page asked for", async () => {
  backend(
    () =>
      new Response("{}", {
        status: 200,
        headers: { "set-cookie": "sermo.session_token=tok; Path=/; HttpOnly" },
      }),
  );
  let digest = "";
  try {
    await login(
      { error: "", username: "" },
      form({ username: "ann", password: "right", next: "/threads/3" }),
    );
  } catch (error) {
    digest = String((error as { digest?: unknown }).digest);
  }
  expect(digest).toMatch(/^NEXT_REDIRECT;[a-z]+;\/threads\/3;/);
  expect(written).toEqual([
    { name: "sermo.session_token", value: "tok", path: "/", httpOnly: true },
  ]);
});

const SIGNED_UP = () =>
  new Response("{}", {
    status: 200,
    headers: { "set-cookie": "sermo.session_token=tok; Path=/; HttpOnly" },
  });

async function signUp(fields: Record<string, string> = {}) {
  let digest = "";
  try {
    await register(
      { error: "", username: "" },
      form({
        username: "ann",
        email: "ann@example.test",
        password: "right-password",
        terms: "on",
        ...fields,
      }),
    );
  } catch (error) {
    digest = String((error as { digest?: unknown }).digest);
  }
  return digest;
}

test("registering from a ?ref= link sends the referrer with the sign-up", async () => {
  backend(SIGNED_UP);
  expect(await signUp({ ref: "12" })).toMatch(/^NEXT_REDIRECT;[a-z]+;\/;/);
  // The sign-up alone carries it: nothing else is asked of the backend.
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ username: "ann", ref: 12 });
  expect(removed).toEqual([]);
});

test("registering with the referral cookie sends its referrer and then drops the cookie", async () => {
  jar.set("forum_ref", "7");
  backend(SIGNED_UP);
  await signUp();
  expect(bodies[0]).toMatchObject({ ref: 7 });
  expect(removed).toEqual(["forum_ref"]);
});

test("the first referrer wins: the cookie over the form", async () => {
  jar.set("forum_ref", "7");
  backend(SIGNED_UP);
  await signUp({ ref: "12" });
  expect(bodies[0]).toMatchObject({ ref: 7 });
});

test("a cookie that names no member does not hide the referrer of the form", async () => {
  jar.set("forum_ref", "junk");
  backend(SIGNED_UP);
  await signUp({ ref: "12" });
  expect(bodies[0]).toMatchObject({ ref: 12 });
});

test("without a referrer, or with an invalid one, the sign-up carries none", async () => {
  for (const ref of [undefined, "", "0", "-1", "abc", "1e2", "1.5"]) {
    bodies.length = 0;
    backend(SIGNED_UP);
    await signUp(ref === undefined ? {} : { ref });
    expect(bodies[0], String(ref)).not.toHaveProperty("ref");
  }
});

test("a sign-up the backend refuses keeps the cookie", async () => {
  jar.set("forum_ref", "7");
  backend(() =>
    Response.json({ code: "USER_ALREADY_EXISTS" }, { status: 422 }),
  );
  const state = await register(
    { error: "", username: "" },
    form({
      username: "ann",
      email: "ann@example.test",
      password: "right-password",
      terms: "on",
    }),
  );
  expect(state.error).toBe(messages.auth.actions.errors.emailTaken);
  expect(removed).toEqual([]);
});

test("a site that asks for email confirmation sends the referrer too", async () => {
  backend(() => new Response("{}", { status: 200 }));
  expect(await signUp({ ref: "12" })).toMatch(
    /^NEXT_REDIRECT;[a-z]+;\/login\?registered=1;/,
  );
  expect(bodies[0]).toMatchObject({ ref: 12 });
});
