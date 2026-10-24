import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { isValidElement } from "react";

// The edits made where a thread is read: what their editors open with, and the saves, which go
// through the same backend writes as the edit page but answer with what changed instead of a
// redirect.

const realFetch = globalThis.fetch;
const asked: { method: string; path: string; body: unknown }[] = [];
let answers: Record<string, { status?: number; body: unknown }> = {};

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));
const cache = { ...(await import("next/cache")) };
mock.module("next/cache", () => ({ ...cache, refresh: () => {} }));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string, values?: { label?: string }) =>
    values?.label ? `${key}:${values.label}` : key,
}));

afterAll(() => {
  mock.module("next/cache", () => cache);
});

const { postBody } = await import("@/lib/test-bodies");
const inPlace = await import("./edit-in-place");

const STAMP = "2026-01-01T00:00:00.000Z";
const solved = { id: 4, label: "Solved", color: "#22aa66", icon: "" };
const someone = { id: 3, username: "ember" };
const thread = (over: Record<string, unknown> = {}) => ({
  id: 7,
  nodeId: 2,
  node: { id: 2, title: "Garden" },
  title: "Tomatoes",
  prefix: null,
  excerpt: "",
  cover: null,
  highlightedUntil: null,
  bumpedAt: null,
  author: someone,
  state: "visible",
  isSticky: false,
  isLocked: false,
  createdAt: STAMP,
  replyCount: 0,
  viewCount: 0,
  firstPostId: 31,
  lastPost: { postId: 31, position: 0, postedAt: STAMP, user: someone },
  readPosition: null,
  isUnread: false,
  pollKind: null,
  ...over,
});
const found = (canEditTitle: boolean, over: Record<string, unknown> = {}) => ({
  thread: thread(over),
  seo: {
    title: "Tomatoes",
    description: "",
    canonical: "http://localhost/threads/7",
    robots: "index,follow",
    redirect: false,
    jsonLd: [],
  },
  node: { id: 2, title: "Garden" },
  watching: null,
  tags: [],
  poll: { exists: false, canAdd: false },
  featured: null,
  permissions: {
    canReply: true,
    canEditTitle,
    canEditTags: false,
    canModerate: false,
    canReport: true,
    canDelete: false,
    canLock: false,
    canHardDelete: false,
    canRemoveCover: false,
    canWatch: true,
  },
  resolvedPermissions: {},
});
const listedPrefix = (prefix: typeof solved) => ({
  ...prefix,
  colorId: 1,
  position: 0,
  isActive: true,
  createdAt: STAMP,
  updatedAt: STAMP,
});
const forum = (requirePrefix: boolean) => ({
  node: {
    id: 2,
    parentId: null,
    type: "forum",
    title: "Garden",
    description: "",
    icon: null,
    iconKey: null,
    cover: null,
    position: 1,
    tabId: null,
    depth: 0,
    threadCount: 0,
    postCount: 0,
    lastPost: null,
    permissions: { canPost: true, canModerate: false },
    settings: {
      requireThreadApproval: false,
      requireReplyApproval: false,
      isReadOnly: false,
      countsPosts: true,
      minAccountAgeDays: 0,
      minPostCount: 0,
      requirePrefix,
    },
  },
  watching: null,
  seo: {
    title: "Garden",
    description: "",
    canonical: "http://localhost/forums/2",
    robots: "index,follow",
    redirect: false,
    jsonLd: [],
  },
  breadcrumbs: [],
  resolvedPermissions: {},
});

beforeEach(() => {
  asked.length = 0;
  answers = {};
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const { pathname } = new URL(url);
    const path = pathname.replace("/api/v1", "");
    asked.push({
      method,
      path,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const given = answers[`${method} ${path}`] ?? {
      status: 404,
      body: { error: { code: "not_found", message: path } },
    };
    return Response.json(given.body, { status: given.status ?? 200 });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const writes = () => asked.filter(({ method }) => method !== "GET");

test("saving a post in place sends the text and answers with the post as drawn now, without a redirect", async () => {
  answers["PATCH /posts/31"] = {
    body: postBody({
      bodyHtml: "<p>new words</p>",
      editedAt: "2026-02-01T00:00:00.000Z",
    }),
  };
  const saved = await inPlace.savePostInPlace(
    7,
    31,
    false,
    form({ body: "new words" }),
  );
  if ("error" in saved) throw new Error(saved.error);
  expect(writes()).toEqual([
    {
      method: "PATCH",
      path: "/posts/31",
      body: { body: "new words", reason: "" },
    },
  ]);
  // The text is the page's own drawing of a post's body, given the saved post.
  expect(isValidElement(saved.body)).toBe(true);
  const body = saved.body as { props: { post: { bodyHtml: string } } };
  expect(body.props.post.bodyHtml).toBe("<p>new words</p>");
  const edited = saved.edited as { props: { date: string } };
  expect(edited.props.date).toBe("2026-02-01T00:00:00.000Z");
  // The thread's title was not in the form: the heading stays as it is.
  expect(saved.thread).toBeUndefined();
});

test("an opening post saved in place with a new title saves the title first and answers with the heading", async () => {
  answers["PATCH /threads/7"] = {
    body: thread({ title: "Ripe tomatoes", prefix: solved }),
  };
  answers["PATCH /posts/31"] = { body: postBody() };
  const saved = await inPlace.savePostInPlace(
    7,
    31,
    false,
    form({
      body: "b",
      title: "Ripe tomatoes",
      titleWas: "Tomatoes",
      prefixId: "4",
      prefixWas: "",
    }),
  );
  if ("error" in saved) throw new Error(saved.error);
  expect(writes().map(({ path }) => path)).toEqual(["/threads/7", "/posts/31"]);
  expect(writes()[0].body).toEqual({ title: "Ripe tomatoes", prefixId: 4 });
  expect(saved.thread).toEqual({ title: "Ripe tomatoes", prefix: solved });
});

test("a refused save in place is the backend's word, and the post is not drawn", async () => {
  answers["PATCH /posts/31"] = {
    status: 403,
    body: { error: { code: "forbidden", message: "The thread is locked." } },
  };
  expect(
    await inPlace.savePostInPlace(7, 31, false, form({ body: "b" })),
  ).toEqual({
    error: "The thread is locked.",
  });
});

test("the post's editor opens with its BB code, and the thread's title only for an opening post its viewer may retitle", async () => {
  answers["GET /posts/31"] = {
    body: postBody({ bodySource: "[b]hi[/b]", canEdit: true }),
  };
  answers["GET /threads/7"] = { body: found(true) };
  answers["GET /thread-prefixes"] = {
    body: { items: [listedPrefix(solved)] },
  };
  const opened = await inPlace.postEditorAction(7, 31);
  if ("error" in opened) throw new Error(opened.error);
  expect(opened.fields.source).toBe("[b]hi[/b]");
  expect(opened.fields.thread).toMatchObject({
    title: "Tomatoes",
    prefixId: "",
    prefixes: [solved],
    mustHavePrefix: false,
  });

  answers["GET /threads/7"] = { body: found(false) };
  const reply = await inPlace.postEditorAction(7, 31);
  if ("error" in reply) throw new Error(reply.error);
  expect(reply.fields.thread).toBeNull();
});

test("a post its viewer may not edit, or that is not the thread's, opens no editor", async () => {
  answers["GET /threads/7"] = { body: found(false) };
  answers["GET /posts/31"] = { body: postBody({ canEdit: false }) };
  expect(await inPlace.postEditorAction(7, 31)).toEqual({ error: "" });
  answers["GET /posts/31"] = { body: postBody({ threadId: 8 }) };
  expect(await inPlace.postEditorAction(7, 31)).toEqual({ error: "" });
});

test("the thread's editor opens with its title and prefix, and only for those who may change them", async () => {
  answers["GET /threads/7"] = { body: found(true, { prefix: solved }) };
  answers["GET /thread-prefixes"] = { body: { items: [] } };
  answers["GET /nodes/2"] = { body: forum(true) };
  const opened = await inPlace.threadEditorAction(7);
  if ("error" in opened) throw new Error(opened.error);
  // A prefix the forum no longer offers stays the thread's, marked as such.
  expect(opened.fields).toEqual({
    title: "Tomatoes",
    prefixId: "4",
    prefixes: [{ ...solved, label: "inactivePrefix:Solved" }],
    mustHavePrefix: false,
  });
  answers["GET /threads/7"] = { body: found(false) };
  expect(await inPlace.threadEditorAction(7)).toEqual({ error: "" });
});

test("saving the thread's title in place sends what changed and answers with the heading; nothing changed sends nothing", async () => {
  expect(
    await inPlace.saveThreadInPlace(
      7,
      form({
        title: "Tomatoes",
        titleWas: "Tomatoes",
        prefixId: "4",
        prefixWas: "4",
      }),
    ),
  ).toEqual({ heading: null });
  expect(writes()).toEqual([]);

  answers["PATCH /threads/7"] = { body: thread({ title: "Tomatoes" }) };
  expect(
    await inPlace.saveThreadInPlace(
      7,
      form({
        title: "Tomatoes",
        titleWas: "Tomatoes",
        prefixId: "",
        prefixWas: "4",
      }),
    ),
  ).toEqual({ heading: { title: "Tomatoes", prefix: null } });
  // "(No prefix)" takes the prefix off.
  expect(writes()[0].body).toEqual({ title: "Tomatoes", prefixId: null });
});

test("a refused title is the backend's word", async () => {
  answers["PATCH /threads/7"] = {
    status: 422,
    body: {
      error: {
        code: "validation",
        message: "Invalid.",
        issues: [{ path: ["prefixId"], message: "This forum needs a prefix." }],
      },
    },
  };
  expect(
    await inPlace.saveThreadInPlace(
      7,
      form({ title: "T", titleWas: "T", prefixId: "", prefixWas: "4" }),
    ),
  ).toEqual({ error: "This forum needs a prefix." });
});
