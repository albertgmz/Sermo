import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { postBody } from "@/lib/test-bodies";
import { formattedTranslator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

// The postbit beside a post and the member's card draw one block: the same parts in the same
// order. Both are rendered here for one member, from the same backend answers, the post the way
// the thread page draws it (the rows it adds while open go through the same `PostItem` and reads).

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
const ALL = { following: false, canFollow: true, canMessage: true };
const NOTHING = { following: false, canFollow: false, canMessage: false };

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
  canReport: true,
});

// Answers each read by its path and keeps every path asked.
function backend(
  options: {
    cover?: typeof COVER | null;
    awards?: unknown[];
    relation?: typeof ALL;
    signedIn?: boolean;
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
              title: "Senior member",
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

// The same markup without the viewer's actions: only the card carries them.
function withoutActions(block: string) {
  const start = block.indexOf('<div data-slot="postbit-actions"');
  expect(start).toBeGreaterThanOrEqual(0);
  return block.replace(divFrom(block, start), "");
}

// The frame places the block in its grid (a border and a margin on the block itself): only those
// classes, on the block's own element, may differ. The cover, the parts and their classes may not.
// The card's block has the viewer's actions as well, and the post's block never does.
const FRAME_PLACEMENT = " max-md:mb-2 md:border-r md:pr-4";
const placedByFrame = (block: string) => {
  const end = block.indexOf(">");
  const tag = block.slice(0, end);
  expect(tag).toContain(FRAME_PLACEMENT);
  return tag.replace(FRAME_PLACEMENT, "") + block.slice(end);
};

// A post of the member as the thread draws it, and the member's card. The post's own postbit opens
// a card and the card's does not, so the post is drawn in the scope that keeps names plain links,
// as the card is: the comparison proves the parts, their order and their classes, not the card
// trigger around the post's name and avatar (`postbit.test.tsx` covers that).
async function both() {
  const card = await html(await loadMemberCard(7, "ember"));
  const [row] = await postRows([
    postBody({ id: 32, position: 26, author: ember }) as Parameters<
      typeof postRows
    >[0][number],
  ]);
  const post = await html(
    <MemberCardScope disabled>{row.node}</MemberCardScope>,
  );
  return { card, post };
}

test("a member with a cover and awards: the card's block is the post's block, part for part, and only the card has the actions", async () => {
  backend();
  const { card, post } = await both();
  const block = postbitOf(card);
  expect(post).not.toContain("member-actions");
  expect(post).not.toContain("postbit-actions");
  expect(placedByFrame(postbitOf(post))).toBe(withoutActions(block));
  // and the card holds every part, in order: cover, avatar, name, badge, actions, title, level, awards, facts
  const order = [
    COVER.url,
    'data-slot="avatar"',
    ">ember<",
    "Moderator",
    'data-slot="member-actions"',
    ">Senior member</p>",
    'data-slot="postbit-level"',
    'href="/awards"',
    ">Joined</dt>",
  ].map((part) => block.indexOf(part));
  expect(order).not.toContain(-1);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  // the cover has the column's shape from md in both, as wide as the holder says
  expect(block).toContain("md:w-[var(--postbit-cover-width,100%)]");
  expect(post).toContain(
    "--postbit-cover-width:calc(var(--postbit-width) + 1rem)",
  );
  // the card adds only the way to the profile, after the block
  const rest = card.slice(card.indexOf(block) + block.length);
  expect(rest).toContain("View profile");
  expect(card.split("View profile").length - 1).toBe(1);
  expect(post).not.toContain("View profile");
});

test("a member without a cover: no cover in either, and still the same block", async () => {
  backend({ cover: null });
  const { card, post } = await both();
  expect(card).not.toContain("background-image");
  expect(postbitOf(post)).not.toContain("background-image");
  expect(placedByFrame(postbitOf(post))).toBe(withoutActions(postbitOf(card)));
});

test("a member without awards: no awards row in either, and still the same block", async () => {
  backend({ awards: [] });
  const { card, post } = await both();
  expect(card).not.toContain('href="/awards"');
  expect(postbitOf(post)).not.toContain('href="/awards"');
  expect(placedByFrame(postbitOf(post))).toBe(withoutActions(postbitOf(card)));
});

test("yourself, or a member nothing is allowed for: neither the post nor the card has actions", async () => {
  backend({ relation: NOTHING });
  const { card, post } = await both();
  expect(card).not.toContain("postbit-actions");
  expect(post).not.toContain("postbit-actions");
  expect(placedByFrame(postbitOf(post))).toBe(postbitOf(card));
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
