import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { postBody } from "@/lib/test-bodies";
import { formattedTranslator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

// The member's card, laid out as XenForo's member tooltip, and the postbit beside a post: the card
// carries the viewer's actions and the last activity, posts and messages carry neither. Both are
// rendered here for one member, from the same backend answers, the post the way the thread page
// draws it (the rows it adds while open go through the same `PostItem` and reads).

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({
    get: () => undefined,
    set: () => {},
    toString: () => "",
  }),
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({ ...nextCache, refresh: () => {} }));
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
  mock.module("next/cache", () => nextCache);
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
  mock.module("next-intl/server", () => intlServer);
});

const source = "./member-card-action.tsx?shared";
const { loadMemberCard } = (await import(
  source
)) as typeof import("./member-card-action");
const { postRows } = await import(
  "@/app/[locale]/(main)/threads/[id]/post-item"
);
const { messageRows } = await import(
  "@/app/[locale]/(main)/conversations/[id]/message-item"
);
const { MemberCardScope } = await import("./member-card-scope");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const ember = { id: 7, username: "ember" };
const COVER = { fileId: 40, url: "/api/v1/files/40/cover.webp" };
const AWARDS = [
  { id: 1, name: "First post", icon: "star", image: null, tier: "gold" },
  { id: 2, name: "Helper", icon: "heart", image: null, tier: "silver" },
  { id: 3, name: "Regular", icon: "flame", image: null, tier: "bronze" },
];
const ALL = {
  following: false,
  canFollow: true,
  canMessage: true,
  ignoring: false,
  canIgnore: true,
};
const NOTHING = {
  following: false,
  canFollow: false,
  canMessage: false,
  ignoring: false,
  canIgnore: false,
};

const threadBody = {
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
    replyCount: 1,
    viewCount: 1,
    firstPostId: 1,
    lastPost: {
      postId: 31,
      position: 25,
      postedAt: "2026-01-01T00:00:00.000Z",
      user: ember,
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
  resolvedPermissions: {},
};

const message = (id: number) => ({
  id,
  conversationId: 4,
  author: ember,
  state: "visible",
  createdAt: "2026-01-01T00:00:00.000Z",
  editedAt: null,
  bodyHtml: "<p>hi</p>",
  attachmentCount: 0,
  attachments: [],
  reactions: { counts: {}, total: 0, mine: null },
  canEdit: false,
  canDelete: false,
  canHardDelete: false,
  canReport: true,
  deletion: null,
});

// Answers each read by its path and keeps every path asked.
function backend(
  options: {
    cover?: typeof COVER | null;
    awards?: unknown[];
    relation?: typeof ALL;
    signedIn?: boolean;
    lastActivity?: { at: string | null; hidden: boolean };
    title?: string;
  } = {},
) {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string) => {
    const path = new URL(input).pathname;
    asked.push(path);
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
              title: options.title ?? "Senior member",
              badges: [{ label: "Moderator", color: null, style: "solid" }],
              level: 3,
              restricted: false,
            },
            cover: options.cover === undefined ? COVER : options.cover,
            createdAt: "2025-03-14T10:00:00.000Z",
            postCount: 1280,
            reactionScore: 940,
            awardXp: 150,
            currentLevelXp: 100,
            nextLevelXp: 300,
            awards: options.awards ?? AWARDS,
            signatureHtml: null,
            lastActivityAt:
              options.lastActivity === undefined
                ? "2026-01-01T09:00:00.000Z"
                : options.lastActivity.at,
            lastActivityHidden: options.lastActivity?.hidden ?? false,
          },
        ],
      });
    if (path === "/api/v1/member-relations")
      return Response.json({
        items: [{ userId: 7, ...(options.relation ?? ALL) }],
      });
    if (path === "/api/v1/reaction-types") return Response.json({ items: [] });
    if (path === "/api/v1/bookmarks/status")
      return Response.json({ bookmarked: [] });
    if (path === "/api/v1/threads/7") return Response.json(threadBody);
    if (path === "/api/v1/me")
      return Response.json(viewerBody(options.signedIn ?? true));
    return Response.json(
      { error: { code: "not_found", message: path } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
  return asked;
}

async function html(node: ReactNode) {
  const stream = await renderToReadableStream(withIntl(node));
  await stream.allReady;
  return new Response(stream).text();
}

// The markup of the `div` that starts at `start`, up to its own closing tag.
function divFrom(out: string, start: number) {
  const tags = /<div[\s>]|<\/div>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let match = tags.exec(out); match; match = tags.exec(out)) {
    depth += match[0] === "</div>" ? -1 : 1;
    if (depth === 0) return out.slice(start, tags.lastIndex);
  }
  throw new Error("The element is not closed.");
}

// The markup of the first `data-slot="postbit"` element, up to its own closing tag.
function postbitOf(out: string) {
  const start = out.indexOf('<div data-slot="postbit"');
  expect(start).toBeGreaterThanOrEqual(0);
  return divFrom(out, start);
}

const card = async () => html(await loadMemberCard(7, "ember"));

// A post of the member as the thread draws it.
async function post() {
  const [row] = await postRows([
    postBody({ id: 32, position: 26, author: ember }) as Parameters<
      typeof postRows
    >[0][number],
  ]);
  return html(<MemberCardScope disabled>{row.node}</MemberCardScope>);
}

test("a title that only repeats the group's badge is left out of the member card, and one that adds something stays", async () => {
  backend({ title: "moderator " });
  const repeated = await card();
  expect(repeated).toContain("Moderator");
  expect(repeated).not.toContain("moderator <");
  expect(repeated).not.toMatch(/text-muted-foreground[^>]*>\s*moderator/i);
  backend({ title: "Garden moderator" });
  expect(await card()).toContain(">Garden moderator</p>");
});

test("a member with a cover and awards: every part of XenForo's tooltip, in its order", async () => {
  backend();
  const out = await card();
  expect(out).toContain('data-slot="member-tooltip"');
  // header: cover, avatar, name, badges and level, title, awards, joined, last seen; then the
  // counts, the actions and the way to the profile
  const order = [
    COVER.url,
    'data-slot="avatar"',
    ">ember<",
    "Moderator",
    "LVL",
    ">Senior member</p>",
    'href="/awards"',
    ">Joined</dt>",
    'dateTime="2025-03-14T10:00:00.000Z"',
    ">Last seen</dt>",
    'dateTime="2026-01-01T09:00:00.000Z"',
    ">Posts</dt>",
    ">1,280</dd>",
    ">Reactions</dt>",
    ">940</dd>",
    ">Points</dt>",
    ">150</dd>",
    'data-slot="member-actions"',
    'aria-label="Follow ember"',
    'aria-label="Ignore ember"',
    'aria-label="Send a direct message to ember"',
    "View profile",
  ].map((part) => out.indexOf(part));
  expect(order).not.toContain(-1);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(out.split("View profile").length - 1).toBe(1);
  // the card is not the post's column any more
  expect(out).not.toContain('data-slot="postbit"');
  expect(out).not.toContain('data-slot="activity-hidden"');
});

test("a member who hides their online status, seen by staff: the time with the hidden mark", async () => {
  backend({ lastActivity: { at: "2026-01-01T09:00:00.000Z", hidden: true } });
  const out = await card();
  const seen = out.indexOf(">Last seen</dt>");
  const mark = out.indexOf('data-slot="activity-hidden"');
  expect(seen).toBeGreaterThanOrEqual(0);
  expect(mark).toBeGreaterThan(seen);
  expect(out.slice(mark)).toContain("(hidden)");
});

// The page the member viewed within the hour, as `users.activity` gives it to the viewer.
function placeAnswer(place: unknown) {
  const base = globalThis.fetch;
  globalThis.fetch = (async (input: string, init?: RequestInit) =>
    new URL(input).pathname === "/api/v1/member-activity"
      ? Response.json({
          items: [
            {
              userId: 7,
              activity: {
                at: "2026-01-01T09:00:00.000Z",
                hidden: false,
                place,
              },
            },
          ],
        })
      : base(input, init)) as unknown as typeof fetch;
}

test("the last seen line names the page the member viewed within the hour, linked", async () => {
  backend();
  placeAnswer({ kind: "forum", target: { id: 3, title: "General" } });
  const out = await card();
  const seen = out.indexOf(">Last seen</dt>");
  expect(seen).toBeGreaterThanOrEqual(0);
  expect(out.slice(seen)).toMatch(
    /dateTime="2026-01-01T09:00:00.000Z"[\s\S]*Viewing forum “<a[^>]*href="\/forums\/3"[^>]*>General<\/a>”/,
  );
});

test("a page the viewer may not see is not named on the card, and an hour on only the time shows", async () => {
  backend();
  placeAnswer({ kind: "page", target: null });
  expect(await card()).toContain("Viewing a page");
  backend();
  placeAnswer(null);
  const out = await card();
  expect(out).toContain(">Last seen</dt>");
  expect(out).not.toContain("Viewing");
});

test("no last activity for the viewer: no line for it", async () => {
  backend({ lastActivity: { at: null, hidden: false } });
  const out = await card();
  expect(out).not.toContain("Last seen");
  expect(out).toContain(">Joined</dt>");
});

test("a member without a cover or awards: neither is drawn", async () => {
  backend({ cover: null, awards: [] });
  const out = await card();
  expect(out).not.toContain("background-image");
  expect(out).not.toContain('href="/awards"');
  expect(out).toContain('data-slot="member-tooltip"');
});

test("yourself, or a member nothing is allowed for: the card has no actions, the profile link stays", async () => {
  backend({ relation: NOTHING });
  const out = await card();
  expect(out).not.toContain("member-actions");
  expect(out).toContain("View profile");
});

test("the post's own postbit carries neither the actions nor the last activity", async () => {
  backend();
  const out = postbitOf(await post());
  expect(out).not.toContain("member-actions");
  expect(out).not.toContain("Last seen");
});

test("a guest: no actions on the post, and no relations asked", async () => {
  const asked = backend({ signedIn: false });
  const [row] = await postRows([
    postBody({ id: 32, position: 26, author: ember }) as Parameters<
      typeof postRows
    >[0][number],
  ]);
  expect(await html(row.node)).not.toContain("postbit-actions");
  expect(asked).not.toContain("/api/v1/member-relations");
});

test("posts and messages draw no actions and ask for no relations", async () => {
  let asked = backend();
  const rows = await postRows(
    [32, 33, 34].map(
      (id) =>
        postBody({ id, position: id, author: ember }) as Parameters<
          typeof postRows
        >[0][number],
    ),
  );
  expect(asked).not.toContain("/api/v1/member-relations");
  for (const row of rows) {
    const out = await html(row.node);
    expect(out).not.toContain("member-actions");
    expect(out).not.toContain("postbit-actions");
  }

  asked = backend();
  const messages = await messageRows(
    [51, 52].map(
      (id) => message(id) as Parameters<typeof messageRows>[0][number],
    ),
  );
  expect(asked).not.toContain("/api/v1/member-relations");
  for (const row of messages) {
    const out = await html(row.node);
    expect(out).not.toContain("member-actions");
    expect(out).not.toContain("postbit-actions");
  }
});

// The first paint of a thread or a conversation is drawn by the page's own list (`ThreadPosts`,
// `Messages`), which a test cannot render on its own: a page file exports only what Next allows.
// That they read no relations and give no actions is held here by the source.
test("the thread and conversation pages read no relations and give no actions", () => {
  const pages = resolve(import.meta.dir, "../../app/[locale]/(main)");
  for (const file of ["threads/[id]/page.tsx", "conversations/[id]/page.tsx"]) {
    const source = readFileSync(resolve(pages, file), "utf8");
    for (const name of ["relationsFor", "memberActionsOf", "postbitActions"])
      expect(source).not.toContain(name);
  }
});
