import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { HYDRATED_FIELD } from "@/app/[locale]/(auth)/native-form";
import { messages } from "@/i18n/messages";
import { siteAnswer } from "@/lib/test-bodies";
import { translator } from "@/lib/test-intl";

const realFetch = globalThis.fetch;
const asked: { url: string; headers: Headers; body: string }[] = [];

mock.module("server-only", () => ({}));
const nextCache = await import("next/cache");
// Signing up reads the site through the cached site read.
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
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

const { choosePassword, forgotPassword, login, register, resendVerification } =
  await import("./actions");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
});
beforeEach(() => {
  asked.length = 0;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Signing up reads the site (for the consent it needs); only the auth requests are recorded.
function backend(response: () => Response) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const site = siteAnswer(url);
    if (site) return site;
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

// The form as the hydrated page sends it: its hidden field says so (see `native-form.ts`).
function form(fields: Record<string, string>) {
  const data = new FormData();
  data.set(HYDRATED_FIELD, "1");
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

// The form as the browser sends it when the page's script has not taken over: the field is empty.
function nativeForm(fields: Record<string, string>) {
  const data = form(fields);
  data.set(HYDRATED_FIELD, "");
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

test("the other guest forms, sent before the page's script ran, go back to their page with the refusal named", async () => {
  backend(refused("RATE_LIMITED", 429));
  expect(
    await run(() =>
      forgotPassword(null, nativeForm({ email: "ann@example.test" })),
    ),
  ).toContain(";/forgot-password?refused=rateLimited;");
  expect(
    await run(() => forgotPassword(null, nativeForm({ email: "" }))),
  ).toContain(";/forgot-password?refused=invalidEmail;");
  expect(
    await run(() =>
      resendVerification(null, nativeForm({ email: "ann@example.test" })),
    ),
  ).toContain(";/login?registered=1&form=resend&refused=rateLimited;");
  expect(
    await run(() =>
      resendVerification(
        null,
        nativeForm({ email: "ann@example.test", from: "verify" }),
      ),
    ),
  ).toContain(";/verify-email?refused=rateLimited;");
  expect(
    await run(() =>
      choosePassword(
        null,
        nativeForm({
          token: "tok",
          password: "a-long-password",
          confirm: "other",
        }),
      ),
    ),
  ).toContain(";/reset-password?token=tok&refused=passwordMismatch;");
  expect(
    await run(() =>
      choosePassword(
        null,
        nativeForm({
          token: "tok",
          password: "a-long-password",
          confirm: "a-long-password",
        }),
      ),
    ),
  ).toContain(";/reset-password?token=tok&refused=rateLimited;");
});

test("the hydrated forms get their refusal as a state, not a redirect", async () => {
  backend(refused("RATE_LIMITED", 429));
  const { rateLimited } = messages.auth.actions.errors;
  expect(
    await forgotPassword(null, form({ email: "ann@example.test" })),
  ).toEqual({ error: rateLimited });
  expect(
    await resendVerification(null, form({ email: "ann@example.test" })),
  ).toEqual({ error: rateLimited });
  expect(
    await choosePassword(
      null,
      form({ token: "tok", password: "x-long-password", confirm: "nope" }),
    ),
  ).toEqual({ error: messages.auth.actions.errors.passwordMismatch });
});
