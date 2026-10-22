import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
const asked: string[] = [];
let signedIn = true;
let wall = true;
let nodesStatus = 200;

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "sermo.session_token=x" }),
  cookies: async () => ({ set: () => {}, get: () => undefined }),
}));

const { loadCreateAction } = await import("./create-actions");

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
  },
});

beforeEach(() => {
  asked.length = 0;
  signedIn = true;
  wall = true;
  nodesStatus = 200;
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url));
    if (String(url).endsWith("/me")) {
      const body = viewerBody(signedIn);
      body.permissions.canPostProfile = wall;
      body.resolvedPermissions = { "tag.apply": true };
      return Response.json(body);
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
