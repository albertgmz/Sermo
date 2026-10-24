import { afterEach, expect, mock, test } from "bun:test";
import { siteBody } from "@/lib/test-bodies";
import layout from "../../../messages/en/layout.json";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

mock.module("server-only", () => ({}));
// Bun applies module mocks to the whole run, so these match the ones in the turnstile test.
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

const { guestPostKey } = await import("./guest-posting");

function site(forms: string[] | null) {
  const turnstile = forms && { siteKey: "0x4AAA-site", forms };
  globalThis.fetch = (async () =>
    Response.json(siteBody({ turnstile }))) as unknown as typeof fetch;
}

const allowed = { "forum.guestPost": true };
const open = { isReadOnly: false, minAccountAgeDays: 0, minPostCount: 0 };

test("a guest is offered the form where the forum allows guest posts and the site guards the form", async () => {
  site(["guestPost"]);
  expect(await guestPostKey(false, allowed, open)).toBe("0x4AAA-site");
  // A thread's page knows no rules of its forum: its reply box rests on the permission.
  expect(await guestPostKey(false, allowed)).toBe("0x4AAA-site");
});

test("nothing is offered to a member, where the permission is not held, or without the Turnstile guard", async () => {
  site(["guestPost"]);
  expect(await guestPostKey(true, allowed, open)).toBeNull();
  expect(await guestPostKey(false, { "forum.guestPost": false }, open)).toBe(
    null,
  );
  expect(await guestPostKey(false, {}, open)).toBeNull();
  site(["register"]);
  expect(await guestPostKey(false, allowed, open)).toBeNull();
  site(null);
  expect(await guestPostKey(false, allowed, open)).toBeNull();
});

test("a read-only forum, or one that asks an account's age or posts, offers guests nothing", async () => {
  site(["guestPost"]);
  for (const rules of [
    { ...open, isReadOnly: true },
    { ...open, minAccountAgeDays: 3 },
    { ...open, minPostCount: 5 },
  ])
    expect(await guestPostKey(false, allowed, rules)).toBeNull();
});
