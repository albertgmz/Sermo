import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  usePathname: () => "/conversations/5",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: () => {} }),
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
  mock.module("next-intl", () => intl);
});

const { MessageActions } = await import("./message-actions");

type Props = Parameters<typeof MessageActions>[0];

const message = (over: Record<string, unknown> = {}) =>
  ({
    id: 11,
    conversationId: 5,
    author: { id: 3, username: "ember" },
    state: "visible",
    createdAt: "2026-01-01T00:00:00.000Z",
    editedAt: null,
    bodyHtml: "",
    attachmentCount: 0,
    attachments: [],
    reactions: { counts: {}, total: 0, mine: null },
    canEdit: false,
    canDelete: false,
    ...over,
  }) as Props["message"];

function draw(over: Record<string, unknown>, viewerId: number | null) {
  return renderToStaticMarkup(
    withIntl(
      <MessageActions
        message={message(over)}
        viewerId={viewerId}
        picker={[]}
        reactionTypes={[]}
      />,
    ),
  );
}

const has = (html: string, label: string) =>
  html.includes(`aria-label="${label}"`);

test("the author can delete a message where the backend allows it, and cannot report it", () => {
  const html = draw({ canDelete: true }, 3);
  expect(has(html, "Delete")).toBe(true);
  expect(has(html, "Report")).toBe(false);
  expect(has(html, "Share")).toBe(true);
});

test("the conversation's first message, which the backend will not delete, has no delete", () => {
  expect(has(draw({ canDelete: false }, 3), "Delete")).toBe(false);
});

test("another participant can report a message, and a moderator can also delete it", () => {
  expect(has(draw({}, 9), "Report")).toBe(true);
  expect(has(draw({}, 9), "Delete")).toBe(false);
  const moderator = draw({ canDelete: true }, 9);
  expect(has(moderator, "Delete")).toBe(true);
  expect(has(moderator, "Report")).toBe(true);
});

test("a message has no quote or reply control, and no edit until its source can be read", () => {
  const html = draw({ canEdit: true, canDelete: true }, 3);
  for (const label of ["Quote", "Reply", "Edit"]) {
    expect(has(html, label)).toBe(false);
  }
});

test("a deleted message offers neither share, delete nor report", () => {
  const html = draw({ state: "deleted", canDelete: true }, 9);
  for (const label of ["Share", "Delete", "Report"]) {
    expect(has(html, label)).toBe(false);
  }
});
