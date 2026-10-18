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

test("the comments are drawn in the order given, each with its author and its own anchor", async () => {
  const html = await render();
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
  expect(html).toContain('aria-label="Post comment"');
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

test("the links to more, older and fewer comments are drawn only when given", async () => {
  const none = await render();
  for (const text of ["Show more comments", "Older comments", "Show fewer"]) {
    expect(none).not.toContain(text);
  }
  const html = await render({
    links: { more: "/more", older: "/older", fewer: "/fewer" },
  });
  expect(html).toMatch(/href="\/more"[^>]*>Show more comments</);
  expect(html).toMatch(/href="\/older"[^>]*>Older comments</);
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

test("there is something to draw with a comment, the right to comment, or more comments elsewhere", async () => {
  expect(hasWallComments({ canComment: false }, [])).toBe(false);
  expect(hasWallComments({ canComment: false }, [comment(1)])).toBe(true);
  expect(hasWallComments({ canComment: true }, [])).toBe(true);
  expect(hasWallComments({ canComment: false }, [], { more: "/more" })).toBe(
    true,
  );
});
