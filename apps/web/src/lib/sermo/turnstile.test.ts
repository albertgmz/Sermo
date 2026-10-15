import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { siteBody } from "@/lib/test-bodies";
import layout from "../../../messages/en/layout.json";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));
// Bun applies module mocks to the whole run, so these match the ones in the site test.
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) =>
    (layout.site as Record<string, string>)[key],
}));

const { turnstileKeyFor } = await import("./turnstile");

function site(turnstile: unknown) {
  globalThis.fetch = (async () =>
    Response.json(siteBody({ turnstile }))) as unknown as typeof fetch;
}

test("a form the site guards gets the public key, the others none", async () => {
  site({ siteKey: "0x4AAA-site", forms: ["register", "login"] });
  expect(await turnstileKeyFor("register")).toBe("0x4AAA-site");
  expect(await turnstileKeyFor("login")).toBe("0x4AAA-site");
  expect(await turnstileKeyFor("passwordReset")).toBeNull();
  expect(await turnstileKeyFor("resendConfirmation")).toBeNull();
});

test("a site with Turnstile off draws no widget anywhere", async () => {
  site(null);
  for (const form of [
    "register",
    "login",
    "passwordReset",
    "resendConfirmation",
  ] as const)
    expect(await turnstileKeyFor(form)).toBeNull();
});

test("a backend that cannot be read draws none either, and the secret is not part of the answer", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const logged = spyOn(console, "error").mockImplementation(() => {});
  expect(await turnstileKeyFor("register")).toBeNull();
  logged.mockRestore();
  site({ siteKey: "k", forms: ["register"] });
  // The site contract has no secret: a body that carried one would not pass it through.
  const withSecret = siteBody({
    turnstile: { siteKey: "k", forms: ["register"], secret: "s3cret" },
  });
  globalThis.fetch = (async () =>
    Response.json(withSecret)) as unknown as typeof fetch;
  expect(JSON.stringify(await turnstileKeyFor("register"))).not.toContain(
    "s3cret",
  );
});
