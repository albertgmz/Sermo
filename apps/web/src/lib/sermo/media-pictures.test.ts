import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { postBody, profilePostBody } from "@/lib/test-bodies";
import { viewerBody } from "@/lib/test-viewer";

const realFetch = globalThis.fetch;
let cookie = "";
mock.module("server-only", () => ({}));
const headersModule = { ...(await import("next/headers")) };
const intl = { ...(await import("next-intl/server")) };
mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "sermo.session_token=abc" }),
  cookies: async () => ({ get: () => undefined, toString: () => cookie }),
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
const { pictureDetails, pictureEntry } = await import("./media-pictures");

afterAll(() => {
  mock.module("next/headers", () => headersModule);
  mock.module("next-intl/server", () => intl);
});
beforeEach(() => {
  cookie = "";
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const user = { kind: "member" as const, id: 3, username: "ember" };
const file = (id: number, over: Record<string, unknown> = {}) => ({
  fileId: id,
  url: `/api/v1/files/${id}`,
  contentType: "image/png",
  byteSize: 1,
  width: 640,
  height: 480,
  filename: null,
  thumbnailUrl: `/api/v1/files/${id + 1000}`,
  widths: [{ url: `/api/v1/files/${id + 1000}`, width: 320 }],
  ...over,
});
const thread = (canReply: boolean, state = "visible") => ({
  thread: {
    id: 7,
    nodeId: 2,
    node: { id: 2, title: "Garden" },
    title: "Tomatoes",
    prefix: null,
    excerpt: "",
    cover: null,
    highlightedUntil: null,
    bumpedAt: null,
    author: user,
    state,
    isSticky: false,
    isLocked: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    replyCount: 1,
    viewCount: 1,
    firstPostId: 1,
    lastPost: {
      postId: 31,
      position: 25,
      postedAt: "2026-01-01T00:00:00.000Z",
      user,
    },
    readPosition: null,
    isUnread: false,
    pollKind: null,
  },
  seo: {
    title: "t",
    description: "d",
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
    canReply,
    canEditTitle: false,
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
const like = {
  id: 1,
  title: "Like",
  emoji: "L",
  score: 1,
  position: 0,
  isActive: true,
  image: null,
  frames: null,
  forumIds: [],
  hideWhenLocked: false,
  rule: null,
  access: "open",
  lockHint: null,
};

type Backend = {
  post?: Response;
  wall?: Response;
  canReply?: boolean;
  signedIn?: boolean;
  threadState?: string;
};

// The reads a viewer's details make, answered by path; everything asked is kept.
function backend({
  post,
  wall,
  canReply = true,
  signedIn = true,
  threadState = "visible",
}: Backend = {}) {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const { pathname, search } = new URL(url);
    asked.push(`${pathname}${search}`);
    if (pathname === "/api/v1/me") {
      const body = viewerBody(signedIn);
      body.permissions.canReact = signedIn;
      return Response.json(body);
    }
    if (pathname === "/api/v1/reaction-types")
      return Response.json({ items: [like] });
    if (pathname === "/api/v1/posts/31") return (post ?? notFound()).clone();
    if (pathname === "/api/v1/profile-posts/12")
      return (wall ?? notFound()).clone();
    if (pathname === "/api/v1/threads/7")
      return Response.json(thread(canReply, threadState));
    return notFound();
  }) as unknown as typeof fetch;
  return asked;
}

function notFound() {
  return Response.json(
    { error: { code: "not_found", message: "none" } },
    { status: 404 },
  );
}
const refusal = (status: number, code: string) =>
  Response.json({ error: { code, message: code } }, { status });

const visiblePost = (over: Record<string, unknown> = {}) =>
  Response.json(postBody({ attachments: [file(7)], ...over }));

test("a picture of a post comes with its poster, where it is, the reactions and a reply", async () => {
  const asked = backend({ post: visiblePost() });
  const result = await pictureDetails("post", 31, 7);
  if (result.status !== "ready") throw new Error(result.status);
  const { details } = result;
  expect(details.author).toEqual({ id: 3, username: "ember" });
  expect(details.where).toEqual({
    href: threadHref(7, 25, 31),
    label: "Tomatoes",
  });
  expect(details.picture).toEqual({
    url: "/api/v1/files/7",
    width: 640,
    height: 480,
    widths: [{ url: "/api/v1/files/1007", width: 320 }],
  });
  expect(details.viewerId).toBe(1);
  expect(details.reply).toEqual({ kind: "post", threadId: 7 });
  expect(details.reactions).toMatchObject({
    target: "post",
    id: 31,
    authorId: 3,
    mine: null,
  });
  expect(details.reactions.picker.map((type) => type.id)).toEqual([1]);
  // The thread is read for what it allows, and opening a picture counts no view of it.
  expect(asked).toContain("/api/v1/threads/7?countView=false");
});

test("a viewer who may not reply or react is offered neither, and a guest is told apart", async () => {
  backend({ post: visiblePost({ canReact: false }), canReply: false });
  const locked = await pictureDetails("post", 31, 7);
  if (locked.status !== "ready") throw new Error(locked.status);
  expect(locked.details.reply).toBeNull();
  expect(locked.details.reactions.picker).toEqual([]);

  backend({ post: visiblePost(), signedIn: false });
  const guest = await pictureDetails("post", 31, 7);
  if (guest.status !== "ready") throw new Error(guest.status);
  expect(guest.details.viewerId).toBeNull();
  expect(guest.details.reply).toBeNull();
});

test("a picture on a wall post comes with a comment to write, where the wall allows it", async () => {
  backend({
    wall: Response.json(
      profilePostBody({ attachments: [file(6)], canComment: true }),
    ),
  });
  const result = await pictureDetails("wall", 12, 6);
  if (result.status !== "ready") throw new Error(result.status);
  expect(result.details.where.label).toBeNull();
  expect(result.details.where.href).toBe("/members/9?post=12#profile-post-12");
  expect(result.details.reply).toEqual({ kind: "wall", profilePostId: 12 });
  expect(result.details.reactions.target).toBe("profilePost");
  backend({
    wall: Response.json(profilePostBody({ attachments: [file(6)] })),
  });
  const closed = await pictureDetails("wall", 12, 6);
  if (closed.status !== "ready") throw new Error(closed.status);
  expect(closed.details.reply).toBeNull();
});

test("a post the backend refuses or no longer has is gone, never an error", async () => {
  for (const [status, code] of [
    [404, "not_found"],
    [403, "forbidden"],
    [401, "unauthenticated"],
  ] as const) {
    backend({ post: refusal(status, code) });
    expect(await pictureDetails("post", 31, 7)).toEqual({ status: "gone" });
  }
  backend({ wall: refusal(403, "forbidden") });
  expect(await pictureDetails("wall", 12, 6)).toEqual({ status: "gone" });
});

test("a thread the viewer may not open makes the picture gone as well", async () => {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/me") return Response.json(viewerBody(true));
    if (pathname === "/api/v1/reaction-types")
      return Response.json({ items: [like] });
    if (pathname === "/api/v1/posts/31") return visiblePost();
    return refusal(403, "forbidden");
  }) as unknown as typeof fetch;
  expect(await pictureDetails("post", 31, 7)).toEqual({ status: "gone" });
});

test("a failure of the backend is a failed load that can be tried again", async () => {
  backend({ post: refusal(500, "internal") });
  expect(await pictureDetails("post", 31, 7)).toEqual({ status: "failed" });
  backend({ post: refusal(429, "rate_limited") });
  expect(await pictureDetails("post", 31, 7)).toEqual({ status: "failed" });
});

test("a post that is hidden, or a file that is not one of its pictures, is gone", async () => {
  backend({ post: visiblePost({ state: "deleted" }) });
  expect(await pictureDetails("post", 31, 7)).toEqual({ status: "gone" });
  backend({ post: visiblePost({ state: "moderated" }) });
  expect(await pictureDetails("post", 31, 7)).toEqual({ status: "gone" });
  backend({ post: visiblePost() });
  expect(await pictureDetails("post", 31, 8)).toEqual({ status: "gone" });
  backend({
    post: Response.json(
      postBody({ attachments: [file(7, { contentType: "image/svg+xml" })] }),
    ),
  });
  expect(await pictureDetails("post", 31, 7)).toEqual({ status: "gone" });
});

test("a visible post in a thread that is deleted is gone", async () => {
  backend({ post: visiblePost(), threadState: "deleted" });
  expect(await pictureDetails("post", 31, 7)).toEqual({ status: "gone" });
});

test("what is not a picture reference is gone without asking the backend", async () => {
  const asked = backend({ post: visiblePost() });
  for (const [kind, contentId, fileId] of [
    ["post", 0, 7],
    ["post", 31, -1],
    ["post", 1.5, 7],
    ["post", Number.NaN, 7],
    ["thread", 31, 7],
  ] as const)
    expect(await pictureDetails(kind as "post", contentId, fileId)).toEqual({
      status: "gone",
    });
  expect(asked).toEqual([]);
});

test("with post pictures blocked by LITE the viewer is given no address, in details or entries", async () => {
  cookie = "forum_lite=all";
  backend({ post: visiblePost() });
  const result = await pictureDetails("post", 31, 7);
  if (result.status !== "ready") throw new Error(result.status);
  expect(result.details.picture.url).toBeNull();
  // Nor of its smaller copies.
  expect(result.details.picture.widths).toEqual([]);
  expect(JSON.stringify(result.details)).not.toContain("/api/v1/files/7");
  expect(JSON.stringify(result.details)).not.toContain("/api/v1/files/1007");
  const item = {
    type: "post" as const,
    id: 30,
    createdAt: "2026-01-01T00:00:00.000Z",
    file: file(7),
    postId: 31,
    position: 0,
    threadId: 7,
    threadTitle: "Tomatoes",
  };
  expect(pictureEntry(item, "Picture in Tomatoes", true).url).toBeNull();
  expect(pictureEntry(item, "Picture in Tomatoes", true).widths).toEqual([]);
  expect(pictureEntry(item, "Picture in Tomatoes", false).widths).toEqual([
    { url: "/api/v1/files/1007", width: 320 },
  ]);
  expect(pictureEntry(item, "Picture in Tomatoes", false).url).toBe(
    "/api/v1/files/7",
  );
});
