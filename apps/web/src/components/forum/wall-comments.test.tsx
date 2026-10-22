import { afterAll, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { MemberView } from "@/lib/sermo/views";
import { translator, withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
// HtmlContent reads the BB code labels on the server.
const serverIntl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  ...serverIntl,
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/members/5",
  useSearchParams: () => new URLSearchParams(),
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
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl/server", () => serverIntl);
  mock.module("next-intl", () => intl);
});
const { WallComments, hasWallComments } = await import("./wall-comments");

type Comment = Parameters<typeof WallComments>[0]["comments"][number];

const member = (id: number): MemberView => ({
  id,
  username: `member${id}`,
  avatar: null,
  frame: null,
  nameColor: null,
  nameIcon: null,
  title: "",
  badges: [],
  level: 1,
  restricted: false,
});

const comment = (id: number, state = "visible") =>
  ({
    id,
    profilePostId: 9,
    author: { id: 20 + id, username: `member${20 + id}` },
    state,
    createdAt: "2026-01-02T00:00:00.000Z",
    editedAt: null,
    bodyHtml: `<p>comment ${id}</p>`,
    attachmentCount: 0,
    attachments: [],
    reactions: { counts: {}, total: 0, mine: null },
    canEdit: false,
    canDelete: false,
    canReport: true,
  }) as unknown as Comment;

// The avatars and the bodies are async components: the markup is read once all of it settled.
async function html(node: ReactNode) {
  const stream = await renderToReadableStream(node);
  await stream.allReady;
  return new Response(stream).text();
}

async function render(over: Partial<Parameters<typeof WallComments>[0]> = {}) {
  return html(
    withIntl(
      <WallComments
        anchor="profile-post-9"
        profileUserId={9}
        comments={[comment(1), comment(2)]}
        member={member}
        viewerId={3}
        picker={[]}
        reactionTypes={[]}
        {...over}
      />,
    ),
  );
}

test("the comments are drawn oldest first, each with its author and its own anchor", async () => {
  const html = await render({ comments: [comment(2), comment(1)] });
  expect(html.indexOf("comment 2")).toBeGreaterThan(html.indexOf("comment 1"));
  expect(html).toContain("member21");
  expect(html).toContain('id="profile-comment-1"');
  expect(html).toContain('id="profile-comment-2"');
});

test("the composer is there only with an action, at the post's comment anchor", async () => {
  expect(await render()).not.toContain("profile-post-9-comment");
  expect(await render()).not.toContain("Write a comment…");
  const html = await render({ action: async () => ({}) });
  expect(html).toContain('id="profile-post-9-comment"');
  expect(html).toContain("Write a comment…");
  expect(html).toContain("</svg>Post comment</button>");
  expect(html).not.toContain("contenteditable");
});

test("the comment composer takes files, and the comments show theirs", async () => {
  const html = await render({ action: async () => ({}) });
  expect(html).toContain('name="attachments"');
  expect(html).toContain("Attach");
  const withFile = {
    ...comment(1),
    attachmentCount: 1,
    attachments: [
      {
        fileId: 5,
        url: "/api/v1/files/5",
        contentType: "application/pdf",
        byteSize: 2048,
        width: null,
        height: null,
        filename: "informe económico.pdf",
        thumbnailUrl: null,
        widths: [],
      },
    ],
  } as Comment;
  const shown = await render({ comments: [withFile] });
  expect(shown).toContain('href="/api/v1/files/5"');
  expect(shown).toContain("informe económico.pdf");
});

test("the button for older comments and the link to fewer are drawn only when given", async () => {
  const none = await render();
  for (const text of ["View previous comments", "Show fewer"]) {
    expect(none).not.toContain(text);
  }
  const html = await render({
    earlier: {
      load: async () => ({ rows: [], cursor: null, done: true }),
    },
    links: { fewer: "/fewer" },
  });
  // A button that loads them in place, above the comments: no address to go to.
  expect(html).toMatch(/<button type="button"[^>]*>View previous comments…</);
  expect(html.indexOf("View previous comments")).toBeLessThan(
    html.indexOf("comment 1"),
  );
  expect(html).toMatch(/href="\/fewer"[^>]*>Show fewer comments</);
});

test("a comment that is not visible to everyone says so", async () => {
  expect(await render()).not.toContain("waiting for approval");
  expect(await render({ comments: [comment(1, "moderated")] })).toContain(
    "This is waiting for approval.",
  );
  expect(await render({ comments: [comment(1, "deleted")] })).toContain(
    "This was deleted.",
  );
});

test("there is something to draw with a comment, the right to comment, or older comments to load", async () => {
  expect(hasWallComments({ canComment: false }, [])).toBe(false);
  expect(hasWallComments({ canComment: false }, [comment(1)])).toBe(true);
  expect(hasWallComments({ canComment: true }, [])).toBe(true);
  expect(
    hasWallComments({ canComment: false }, [], {
      load: async () => ({ rows: [], cursor: null, done: true }),
    }),
  ).toBe(true);
});

test("the block keeps XenForo's order: who reacted, the older comments, the comments, the composer", async () => {
  const html = await render({
    summary: <i data-mark="summary" />,
    earlier: {
      load: async () => ({ rows: [], cursor: null, done: true }),
    },
    action: async () => ({}),
  });
  const at = (text: string) => html.indexOf(text);
  expect(at('data-mark="summary"')).toBeGreaterThan(-1);
  expect(at('data-mark="summary"')).toBeLessThan(at("View previous comments"));
  expect(at("View previous comments")).toBeLessThan(at("comment 1"));
  expect(at("comment 2")).toBeLessThan(at('id="profile-post-9-comment"'));
});

test("each row has its own border over its neighbour's, and the summary row goes while nobody reacted", async () => {
  const html = await render({ summary: <i data-mark="summary" /> });
  expect(html).not.toContain("border-l pl-3");
  expect(html).toMatch(
    /<div class="-mt-px border bg-muted\/60 px-2 flex py-0.5 empty:hidden"><i data-mark="summary"/,
  );
  expect(html).toMatch(/<article id="profile-comment-1" class="-mt-px border/);
  // No summary given: no row for it.
  expect(await render()).not.toContain("py-0.5 empty:hidden");
});

test("a comment is its avatar, the author's name, the text, then one footer with the date", async () => {
  const html = await render({ comments: [comment(1)] });
  const row = html.slice(html.indexOf('id="profile-comment-1"'));
  const at = (text: string) => row.indexOf(text);
  expect(at("member21")).toBeLessThan(at("comment 1"));
  expect(at("comment 1")).toBeLessThan(at("<time"));
  expect(row.match(/data-slot="content-actions"/g)).toHaveLength(1);
  // The date sits in the footer, not beside the name.
  expect(row).not.toContain("· ");
});

test("the composer row carries the viewer's avatar before the line", async () => {
  const html = await render({ action: async () => ({}) });
  const composer = html.slice(html.indexOf('id="profile-post-9-comment"'));
  expect(composer.indexOf('aria-label="member3"')).toBeGreaterThan(-1);
  expect(composer.indexOf('aria-label="member3"')).toBeLessThan(
    composer.indexOf("<form"),
  );
});

test("on a phone the composer spans the row: the viewer's avatar sits beside it from md up only", async () => {
  const html = await render({ action: async () => ({}) });
  const composer = html.slice(html.indexOf('id="profile-post-9-comment"'));
  const at = composer.indexOf('aria-label="member3"');
  const tag = composer.slice(
    composer.lastIndexOf("<a", at),
    composer.indexOf(">", at),
  );
  const classes = tag.match(/class="([^"]*)"/)?.[1].split(" ");
  expect(classes).toContain("hidden");
  expect(classes).toContain("md:block");
  expect(composer).toMatch(/<form[^>]*class="[^"]*\bflex-1\b/);
});

test("a comment's footer: on a phone the whole date on a line of its own under the text, the buttons on the next; from sm one line with the date giving way; report an icon on a phone, small gaps, pills on the card", async () => {
  const edited = {
    ...comment(1),
    editedAt: "2026-01-03T00:00:00.000Z",
    canEdit: true,
    canDelete: true,
  } as unknown as Comment;
  // A moderator on someone else's comment: every tool at once.
  const moderated = { ...edited, canReport: true } as unknown as Comment;
  for (const item of [comment(1), edited, moderated]) {
    const markup = await render({ comments: [item] });
    const footer = markup.slice(markup.indexOf('data-slot="content-actions"'));
    const classes = (pattern: RegExp) =>
      footer.match(pattern)?.[1].split(" ") ?? [];
    const row = classes(/<div class="([^"]*justify-between[^"]*)">/);
    // A phone: the row wraps, its left side dissolves into it (`contents`), and the date takes a
    // whole line, never cut; the buttons follow on the next line, react at its end.
    expect(row).toContain("max-sm:flex-wrap");
    expect(row).toContain("flex-nowrap");
    expect(row).not.toContain("flex-wrap");
    expect(row).toContain("gap-1");
    expect(row).toContain("[--action-fill:var(--card)]");
    const left = classes(/justify-between[^"]*"><div class="([^"]*)">/);
    expect(left).toContain("max-sm:contents");
    // From sm: one line, the left side (the date) gives way, the buttons keep their size.
    expect(left).toContain("min-w-0");
    expect(left).toContain("flex-nowrap");
    expect(left).toContain("gap-1");
    const date = classes(/<span class="([^"]*)"><time/);
    expect(date).toContain("max-sm:basis-full");
    expect(date).toContain("sm:truncate");
    expect(date).not.toContain("truncate");
    expect(date).not.toContain("whitespace-nowrap");
    expect(date).toContain("min-w-0");
    expect(date).not.toContain("px-2");
  }
  const member = await render({ comments: [comment(1)] });
  expect(member).toContain('<span class="hidden sm:inline">Report</span>');
});
