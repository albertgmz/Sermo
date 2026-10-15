import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { formattedTranslator, withIntl } from "@/lib/test-intl";

// A member whose account waits for approval opens the security page. What the backend refuses
// that account is shown as a missing list, never as the approval screen or a crash.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const intl = await import("next-intl/server");
const nextCache = await import("next/cache");
mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "sermo.session_token=live" }),
  cookies: async () => ({ set: () => {}, get: () => undefined }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => formattedTranslator(namespace),
}));

const { SignInHistory } = await import("./sign-in-history");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const REFUSAL = {
  error: {
    code: "forbidden",
    message: "Your account is waiting for staff to approve it.",
    issues: [{ path: ["approval"], message: "awaiting" }],
  },
};

test("the sign-in history a waiting account is refused says it could not be loaded, and nothing else", async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string) => {
    asked.push(new URL(input).pathname);
    return Response.json(REFUSAL, { status: 403 });
  }) as unknown as typeof fetch;
  const html = await new Response(
    await renderToReadableStream(withIntl(await SignInHistory())),
  ).text();
  expect(asked.length).toBeGreaterThan(0);
  expect(html).toContain("The sign-in history could not be loaded");
  expect(html).not.toContain("waiting for staff");
});
