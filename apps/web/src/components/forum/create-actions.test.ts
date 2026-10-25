import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { siteBody } from "@/lib/test-bodies";
import { translator } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
const asked: string[] = [];
let signedIn = true;
let wall = true;
let nodesStatus = 200;
let site = siteBody();

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "sermo.session_token=x" }),
  cookies: async () => ({ set: () => {}, get: () => undefined }),
}));
// The site is read for its +18 mode.
const intl = { ...(await import("next-intl/server")) };
const nextCache = { ...(await import("next/cache")) };
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/cache", () => ({
  ...nextCache,
  cacheLife: () => {},
  cacheTag: () => {},
}));
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => nextCache);
});

const { loadCreateAction } = await import("./create-actions");

// The member's preferences as the backend answers them.
const PREFERENCES = {
  watchOnCreate: "watch_email",
  watchOnReply: "watch",
  language: null,
  profileViewPrivacy: "everyone",
  profilePostPrivacy: "members",
  keyboardShortcuts: true,
  homeTab: null,
  feedView: "cards",
  theme: null,
  showOnline: true,
};
let preferencesBody = PREFERENCES;

const node = (id: number, parentId: number | null, canPost: boolean) => ({
  id,
  parentId,
  type: parentId === null ? "category" : "forum",
  title: `Node ${id}`,
  description: "",
  icon: null,
  iconKey: null,
  cover: null,
  position: id,
  tabId: null,
  depth: parentId === null ? 0 : 1,
  threadCount: 0,
  postCount: 0,
  lastPost: null,
  permissions: { canPost, canModerate: false },
  settings: {
    requireThreadApproval: false,
    requireReplyApproval: false,
    isReadOnly: false,
    countsPosts: true,
    minAccountAgeDays: 0,
    minPostCount: 0,
    requirePrefix: false,
    isAdult: false,
  },
  adultByParent: false,
});

beforeEach(() => {
  asked.length = 0;
  preferencesBody = PREFERENCES;
  signedIn = true;
  wall = true;
  nodesStatus = 200;
  site = siteBody();
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url));
    if (String(url).endsWith("/site")) return Response.json(site);
    if (String(url).endsWith("/me")) {
      const body = viewerBody(signedIn);
      body.permissions.canPostProfile = wall;
      body.resolvedPermissions = { "tag.apply": true };
      return Response.json(body);
    }
    if (String(url).endsWith("/me/preferences")) {
      return Response.json(preferencesBody);
    }
    if (String(url).endsWith("/nodes")) {
      if (nodesStatus !== 200) {
        return Response.json(
          { error: { code: "internal", message: "Down." } },
          { status: nodesStatus },
        );
      }
      return Response.json({
        items: [node(1, null, false), node(2, 1, true), node(3, 1, false)],
      });
    }
    return Response.json({ items: [] });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("the flow gets the forums with the postable ones marked and the two global permissions", async () => {
  const loaded = await loadCreateAction();
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  expect(loaded.data.memberId).toBe(1);
  expect(loaded.data.forums.map((forum) => [forum.id, forum.canPost])).toEqual([
    [1, false],
    [2, true],
    [3, false],
  ]);
  expect(loaded.data.canTag).toBe(true);
  expect(loaded.data.canWall).toBe(true);
  // A forum's prefixes are asked when the forum is chosen, not for all of them at once.
  expect(asked.some((url) => url.includes("thread-prefixes"))).toBe(false);
});

test("a member who may not post on their wall is told so", async () => {
  wall = false;
  const loaded = await loadCreateAction();
  expect(loaded.ok && loaded.data.canWall).toBe(false);
});

test("a guest gets nothing and no forum is asked for", async () => {
  signedIn = false;
  expect(await loadCreateAction()).toEqual({ ok: false });
  expect(asked.some((url) => url.endsWith("/nodes"))).toBe(false);
});

test("a refused read is an answer that says so, not a thrown error", async () => {
  nodesStatus = 403;
  expect(await loadCreateAction()).toEqual({ ok: false });
});

test("the flow starts the watch options from the member's preference for threads they start", async () => {
  const loaded = await loadCreateAction();
  expect(loaded.ok && loaded.data.watchOnCreate).toBe("watch_email");
  preferencesBody = { ...preferencesBody, watchOnCreate: "none" };
  const again = await loadCreateAction();
  expect(again.ok && again.data.watchOnCreate).toBe("none");
});

test("the composer offers the +18 mark only while the site's +18 mode is on", async () => {
  const off = await loadCreateAction();
  expect(off.ok && off.data.adultMode).toBe(false);
  site = siteBody({ adultMode: true });
  const on = await loadCreateAction();
  expect(on.ok && on.data.adultMode).toBe(true);
});
