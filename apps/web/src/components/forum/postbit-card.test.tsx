import { afterAll, afterEach, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";

// The postbit beside a post and the member's card draw one block: the same parts in the same
// order. Both are rendered here for one member, from the same backend answers.

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
  usePathname: () => "/threads/1",
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
afterAll(() => {
  mock.module("next/cache", () => nextCache);
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
});

const source = "./member-card-action.tsx?shared";
const { loadMemberCard } = (await import(
  source
)) as typeof import("./member-card-action");
const { PostFrame } = await import("./post-frame");
const { MemberCardScope } = await import("./member-card-scope");
const { memberActionsOf } = await import("./member-actions");
const { authorsFor, relationsFor } = await import("@/lib/sermo/members");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const COVER = { fileId: 40, url: "/api/v1/files/40/cover.webp" };
const AWARDS = [
  { id: 1, name: "First post", icon: "star", image: null, tier: "gold" },
  { id: 2, name: "Helper", icon: "heart", image: null, tier: "silver" },
  { id: 3, name: "Regular", icon: "flame", image: null, tier: "bronze" },
];

function backend(options: { cover?: typeof COVER | null; awards?: unknown[] }) {
  globalThis.fetch = (async (input: string) => {
    const path = new URL(input).pathname;
    if (path.includes("authors"))
      return Response.json({
        items: [
          {
            card: {
              id: 7,
              username: "ember",
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
    if (path.includes("relations"))
      return Response.json({
        items: [
          { userId: 7, following: false, canFollow: true, canMessage: true },
        ],
      });
    return Response.json(viewerBody(true));
  }) as unknown as typeof fetch;
}

async function html(node: ReactNode) {
  const stream = await renderToReadableStream(withIntl(node));
  await stream.allReady;
  return new Response(stream).text();
}

// The markup of the first `data-slot="postbit"` element, up to its own closing tag.
function postbitOf(out: string) {
  const start = out.indexOf('<div data-slot="postbit"');
  expect(start).toBeGreaterThanOrEqual(0);
  const tags = /<div[\s>]|<\/div>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let match = tags.exec(out); match; match = tags.exec(out)) {
    depth += match[0] === "</div>" ? -1 : 1;
    if (depth === 0) return out.slice(start, tags.lastIndex);
  }
  throw new Error("The postbit is not closed.");
}

// What the holder decides is left out: where the block sits in it (the root's classes) and the
// shape of the cover in it (the cover's classes). Everything else must be the same.
const shared = (block: string) =>
  block
    .replace(
      /^(<div data-slot="postbit" data-layout="[a-z]+") class="[^"]*"/,
      "$1",
    )
    .replace(
      /(<div aria-hidden="true") class="[^"]*"( style="background-image)/,
      "$1$2",
    );

// The card as the member's card shows it, and the postbit of one of the member's posts with the
// same actions. The post's own postbit opens a card and the card's does not, so both are drawn
// in a scope that keeps names plain links, as the card is.
async function both() {
  const card = await html(await loadMemberCard(7, "ember"));
  const [author, relation] = await Promise.all([
    authorsFor([{ id: 7, username: "ember" }]),
    relationsFor(1, [7]),
  ]);
  const post = await html(
    <MemberCardScope disabled>
      {PostFrame({
        id: "post-1",
        author: author(7),
        createdAt: "2026-01-02T03:04:05.000Z",
        postbitActions: memberActionsOf(author(7).member, relation(7)),
        actions: null,
        children: null,
      })}
    </MemberCardScope>,
  );
  return { card, post };
}

test("a member with a cover and awards: the card's block is the post's block, part for part", async () => {
  backend({});
  const { card, post } = await both();
  const block = postbitOf(card);
  expect(shared(block)).toBe(shared(postbitOf(post)));
  // and it holds every part: cover, avatar, name, badge, actions, title, level, awards, facts
  for (const part of [
    COVER.url,
    'data-slot="avatar"',
    ">ember<",
    "Moderator",
    'data-slot="member-actions"',
    ">Senior member</p>",
    'data-slot="postbit-level"',
    'href="/awards"',
    ">Joined</dt>",
  ])
    expect(block).toContain(part);
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
  expect(shared(postbitOf(card))).toBe(shared(postbitOf(post)));
});

test("a member without awards: no awards row in either, and still the same block", async () => {
  backend({ awards: [] });
  const { card, post } = await both();
  expect(card).not.toContain('href="/awards"');
  expect(postbitOf(post)).not.toContain('href="/awards"');
  expect(shared(postbitOf(card))).toBe(shared(postbitOf(post)));
});
