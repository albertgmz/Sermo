import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { postBody } from "@/lib/test-bodies";
import { formattedTranslator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

// A thread post's header row, drawn by `postRows` (the rows added to an open last page) from faked
// backend answers: the same `PostItem` the page draws.

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    toString: () => "",
  }),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/threads/7",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
// Another suite replaces the translator with one that fills no placeholders: use the real one.
const intl = { ...(await import("next-intl")) };
const { useTranslations } = await import("use-intl");
mock.module("next-intl", () => ({
  ...intl,
  useLocale: () => "en",
  useTranslations,
}));
const intlServer = { ...(await import("next-intl/server")) };
mock.module("next-intl/server", () => ({
  ...intlServer,
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => formattedTranslator(namespace),
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
  mock.module("next-intl/server", () => intlServer);
});
const { postRows } = await import("./post-item");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ember = { kind: "member" as const, id: 7, username: "ember" };

function threadBody(
  readPosition: number | null,
  resolvedPermissions: Record<string, boolean> = {},
) {
  return {
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
      author: ember,
      state: "visible",
      isSticky: false,
      isLocked: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      replyCount: 3,
      viewCount: 1,
      firstPostId: 1,
      lastPost: {
        postId: 33,
        position: 3,
        postedAt: new Date().toISOString(),
        user: ember,
      },
      readPosition,
      isUnread: true,
      pollKind: null,
      isAdult: false,
      adultByForum: false,
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
      canReply: true,
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
    resolvedPermissions,
  };
}

function backend({
  signedIn = true,
  readPosition = null as number | null,
  resolved = {} as Record<string, boolean>,
}) {
  globalThis.fetch = (async (input: string) => {
    const path = new URL(input).pathname;
    if (path === "/api/v1/member-authors")
      return Response.json({
        items: [
          {
            card: {
              ...ember,
              avatar: null,
              frame: null,
              nameColor: null,
              nameIcon: null,
              title: "",
              badges: [],
              level: 1,
              restricted: false,
            },
            cover: null,
            createdAt: "2025-03-14T10:00:00.000Z",
            postCount: 3,
            reactionScore: 0,
            awardXp: 0,
            currentLevelXp: 0,
            nextLevelXp: 100,
            awards: [],
            signatureHtml: null,
            lastActivityAt: null,
            lastActivityHidden: false,
          },
        ],
      });
    if (path === "/api/v1/reaction-types") return Response.json({ items: [] });
    if (path === "/api/v1/bookmarks/status")
      return Response.json({ bookmarked: [] });
    if (path === "/api/v1/threads/7")
      return Response.json(threadBody(readPosition, resolved));
    if (path === "/api/v1/me") return Response.json(viewerBody(signedIn));
    return Response.json(
      { error: { code: "not_found", message: path } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
}

const post = (id: number, position: number) =>
  postBody({
    id,
    position,
    author: ember,
    createdAt: new Date().toISOString(),
    bodyHtml: "<p>hi</p>",
  }) as Parameters<typeof postRows>[0][number];

async function drawn(posts: Parameters<typeof postRows>[0]) {
  const rows = await postRows(posts);
  return Promise.all(
    rows.map(async (row) => {
      const stream = await renderToReadableStream(withIntl(row.node));
      await stream.allReady;
      return new Response(stream).text();
    }),
  );
}

// The markup of the header row: from the post's time up to the body.
function headerOf(html: string) {
  const end = html.indexOf("<p>hi</p>");
  expect(end).toBeGreaterThan(0);
  return html.slice(html.indexOf("<time"), end);
}

test("the header row reads time, then New, share, bookmark and the post number, as on XenForo", async () => {
  backend({ readPosition: 2 });
  const [html] = await drawn([post(33, 3)]);
  const header = headerOf(html);
  const at = (part: string) => header.indexOf(part);
  const order = [
    "<time",
    ">New<",
    'aria-label="Share"',
    'aria-label="Bookmark"',
    ">#4<",
  ].map(at);
  expect(order).not.toContain(-1);
  expect(order).toEqual([...order].sort((a, b) => a - b)); // A refusal of the bookmark floats under it instead of widening the row.
  expect(header).toContain("flex-col relative shrink-0");
});

test("the first link in a post to itself is its number: share is a button, not another link there", async () => {
  backend({ readPosition: 2 });
  const [html] = await drawn([post(33, 3)]);
  const first = html.match(/<a [^>]*href="[^"]*#post-33"[^>]*>(.*?)<\/a>/)?.[1];
  expect(first).toBe("#4");
});

test("the thread starter's mark is a text pill at every width, with no pencil beside share and bookmark", async () => {
  backend({});
  const [html] = await drawn([post(33, 3)]);
  const header = headerOf(html);
  expect(header).toMatch(/<span[^>]*>OP<span class="sr-only">/);
  expect(header).not.toContain("lucide-pen-line");
  // The words are not hidden on a phone, where the mark used to be a bare icon.
  expect(header).not.toMatch(/sr-only sm:not-sr-only">OP/);
});

test("only the posts after the viewer's read position are new", async () => {
  backend({ readPosition: 2 });
  const [read, unread] = await drawn([post(32, 2), post(33, 3)]);
  expect(headerOf(read)).not.toContain(">New<");
  expect(headerOf(unread)).toContain(">New<");
});

test("in a thread the viewer never opened every post is new", async () => {
  backend({ readPosition: null });
  for (const html of await drawn([post(31, 1), post(32, 2)]))
    expect(headerOf(html)).toContain(">New<");
});

test("a guest sees no New badge and no bookmark, and still gets share and the number", async () => {
  backend({ signedIn: false });
  const [html] = await drawn([post(33, 3)]);
  const header = headerOf(html);
  expect(header).not.toContain(">New<");
  expect(header).not.toContain("Bookmark");
  expect(header).toContain('aria-label="Share"');
  expect(header).toContain(">#4<");
});

test("a deleted post has no share in its header", async () => {
  backend({ readPosition: 3 });
  const [html] = await drawn([
    postBody({
      id: 33,
      position: 3,
      author: ember,
      state: "deleted",
      bodyHtml: "<p>hi</p>",
    }) as Parameters<typeof postRows>[0][number],
  ]);
  // Folded to its deletion notice, its text is not drawn until Show: no share anywhere on it.
  expect(html).not.toContain('aria-label="Share"');
});

const deletedPost = (deletion: unknown) =>
  postBody({
    id: 33,
    position: 3,
    author: ember,
    state: "deleted",
    bodyHtml: "<p>hi</p>",
    deletion,
  }) as Parameters<typeof postRows>[0][number];

test("a deleted post says who deleted it and why, to the moderators who see it", async () => {
  backend({ readPosition: 3 });
  const [html] = await drawn([
    deletedPost({
      by: { kind: "member", id: 4, username: "warden" },
      reason: "Off topic",
      at: "2026-01-02T00:00:00.000Z",
    }),
  ]);
  expect(html).toContain("Deleted by warden");
  expect(html).toContain("Reason: Off topic");
  expect(html).not.toContain("This post was deleted. Only");
});

test("a deleted post with no reason names only who deleted it, and one without a record keeps the plain note", async () => {
  backend({ readPosition: 3 });
  const [named, plain] = await drawn([
    deletedPost({
      by: ember,
      reason: "",
      at: "2026-01-02T00:00:00.000Z",
    }),
    deletedPost(null),
  ]);
  expect(named).toContain("Deleted by ember");
  expect(named).not.toContain("Reason:");
  expect(plain).toContain("This post was deleted. Only moderators can see it.");
});

test("a deleted post is folded to one line until Show: who deleted it, when and why, none of its text", async () => {
  backend({ readPosition: 3 });
  const [html] = await drawn([
    deletedPost({
      by: { kind: "member", id: 4, username: "warden" },
      reason: "Off topic",
      at: "2026-01-02T00:00:00.000Z",
    }),
  ]);
  expect(html).not.toContain("<p>hi</p>");
  expect(html).toContain('id="post-33"');
  expect(html).toContain('dateTime="2026-01-02T00:00:00.000Z"');
  expect(html).toMatch(/aria-expanded="false"[^>]*>Show…</);
  // The author and the post number stay on the line.
  expect(html).toContain("ember");
  expect(html).toContain(">#4<");
});

test("the folded line offers Restore and Delete permanently to the staff allowed, and neither to others", async () => {
  backend({
    readPosition: 3,
    resolved: { "forum.undelete": true, "forum.hardDelete": true },
  });
  const deleted = {
    ...(deletedPost(null) as object),
    canHardDelete: true,
  } as Parameters<typeof postRows>[0][number];
  const [staff] = await drawn([deleted]);
  expect(staff).toContain(">Restore<");
  expect(staff).toContain('aria-label="Delete permanently"');

  backend({ readPosition: 3 });
  const [member] = await drawn([deletedPost(null)]);
  expect(member).not.toContain(">Restore<");
  expect(member).not.toContain("Delete permanently");
  expect(member).toContain("Show…");
});
