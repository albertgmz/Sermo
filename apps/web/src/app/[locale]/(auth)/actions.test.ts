import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";

const realFetch = globalThis.fetch;
const written: Record<string, unknown>[] = [];

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
    toString: () => "",
  }),
}));

const { login } = await import("./actions");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
beforeEach(() => {
  written.length = 0;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function backend(response: () => Response) {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(url);
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
