import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";

const realFetch = globalThis.fetch;
const asked: { url: string; headers: Headers; body: string }[] = [];

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    set: () => {},
    get: () => undefined,
    has: () => false,
    delete: () => {},
    toString: () => "",
  }),
}));

const { login, register, forgotPassword, resendVerification } = await import(
  "./actions"
);

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
beforeEach(() => {
  asked.length = 0;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function backend(response: () => Response) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    asked.push({
      url,
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ""),
    });
    return response();
  }) as unknown as typeof fetch;
}

const ok = () => Response.json({});
const refused =
  (code: string, status = 400) =>
  () =>
    Response.json({ code }, { status });

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

// An action ends in a redirect when it worked; its digest says where.
async function run(action: () => Promise<unknown>) {
  try {
    return await action();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
}

const SIGN_IN = { username: "ann", password: "right" };
const SIGN_UP = {
  username: "ann",
  email: "ann@example.test",
  password: "right-password",
  terms: "on",
};
const state = { error: "", username: "" };

test("every guest form sends its widget's token to the backend in a header, never in the body", async () => {
  backend(ok);
  await run(() =>
    login(state, form({ ...SIGN_IN, turnstileToken: "token-username" })),
  );
  await run(() =>
    login(
      state,
      form({
        username: "ann@example.test",
        password: "right",
        turnstileToken: "token-email",
      }),
    ),
  );
  await run(() =>
    register(state, form({ ...SIGN_UP, turnstileToken: "token-register" })),
  );
  await run(() =>
    forgotPassword(
      null,
      form({ email: "ann@example.test", turnstileToken: "token-forgot" }),
    ),
  );
  await run(() =>
    resendVerification(
      null,
      form({ email: "ann@example.test", turnstileToken: "token-resend" }),
    ),
  );
  expect(
    asked.map((call) => [
      new URL(call.url).pathname,
      call.headers.get("x-sermo-turnstile"),
    ]),
  ).toEqual([
    ["/api/auth/sign-in/username", "token-username"],
    ["/api/auth/sign-in/email", "token-email"],
    ["/api/auth/sign-up/email", "token-register"],
    ["/api/auth/request-password-reset", "token-forgot"],
    ["/api/auth/send-verification-email", "token-resend"],
  ]);
  for (const call of asked) expect(call.body).not.toContain("token-");
});

test("a form without a token, or with an empty one, sends no header", async () => {
  backend(ok);
  await run(() => login(state, form(SIGN_IN)));
  await run(() => login(state, form({ ...SIGN_IN, turnstileToken: "" })));
  await run(() => register(state, form(SIGN_UP)));
  expect(asked).toHaveLength(3);
  for (const call of asked)
    expect(call.headers.has("x-sermo-turnstile")).toBe(false);
});

test("the backend's three refusals are said in the form's own words", async () => {
  const { errors } = messages.auth.actions;
  for (const [code, text] of [
    ["TURNSTILE_REQUIRED", errors.turnstileRequired],
    ["TURNSTILE_FAILED", errors.turnstileFailed],
    ["TURNSTILE_UNAVAILABLE", errors.turnstileUnavailable],
  ] as const) {
    backend(refused(code, code === "TURNSTILE_UNAVAILABLE" ? 503 : 400));
    expect(await login(state, form(SIGN_IN))).toEqual({
      error: text,
      username: "ann",
    });
    expect(await register(state, form(SIGN_UP))).toEqual({
      error: text,
      username: "ann",
    });
    expect(
      await forgotPassword(null, form({ email: "ann@example.test" })),
    ).toEqual({ error: text });
    expect(
      await resendVerification(null, form({ email: "ann@example.test" })),
    ).toEqual({ error: text });
  }
});
