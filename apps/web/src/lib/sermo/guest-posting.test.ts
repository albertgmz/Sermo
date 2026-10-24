import { afterEach, expect, mock, test } from "bun:test";
import { siteBody } from "@/lib/test-bodies";
import { viewerBody } from "@/lib/test-viewer";
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
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) =>
    (layout.site as Record<string, string>)[key],
}));

const { guestPostKey, guestReplyKey } = await import("./guest-posting");

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

// The thread page's reply box: the forum is read for its rules, and only when the permission is held.
function forum(settings: Record<string, unknown>) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string) => {
    const { pathname } = new URL(input);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(false));
    asked.push(pathname);
    if (pathname === "/api/v1/site")
      return Response.json(
        siteBody({
          turnstile: { siteKey: "0x4AAA-site", forms: ["guestPost"] },
        }),
      );
    return Response.json({
      node: {
        id: 3,
        parentId: null,
        type: "forum",
        title: "General",
        description: "",
        position: 1,
        depth: 0,
        tabId: null,
        icon: null,
        iconKey: null,
        cover: null,
        threadCount: 0,
        postCount: 0,
        lastPost: null,
        permissions: { canPost: false, canModerate: false },
        settings: {
          requireThreadApproval: false,
          requireReplyApproval: false,
          isReadOnly: false,
          countsPosts: true,
          minAccountAgeDays: 0,
          minPostCount: 0,
          requirePrefix: false,
          ...settings,
        },
      },
      watching: null,
      seo: {
        title: "General",
        description: "",
        canonical: "http://localhost/forums/3",
        robots: "noindex,follow",
        redirect: false,
        jsonLd: [],
      },
      breadcrumbs: [],
      resolvedPermissions: {},
    });
  }) as unknown as typeof fetch;
  return asked;
}

test("a thread's reply box is offered to a guest only where the forum asks no account", async () => {
  forum({});
  expect(await guestReplyKey(false, allowed, 3)).toBe("0x4AAA-site");
  for (const settings of [
    { isReadOnly: true },
    { minAccountAgeDays: 3 },
    { minPostCount: 5 },
  ]) {
    forum(settings);
    expect(await guestReplyKey(false, allowed, 3)).toBeNull();
  }
});

test("the forum is not read for a member or for a guest without the permission", async () => {
  const asked = forum({});
  expect(await guestReplyKey(true, allowed, 3)).toBeNull();
  expect(await guestReplyKey(false, {}, 3)).toBeNull();
  expect(asked).toEqual([]);
});
