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
// The quote button the bar draws, as the bar handed it its props, so its press can be run here.
type QuoteProps = Parameters<
  typeof import("@/components/forum/quote-button").QuoteButton
>[0];
let quoteProps: QuoteProps | undefined;
const realQuote = { ...(await import("@/components/forum/quote-button")) };
mock.module("@/components/forum/quote-button", () => ({
  ...realQuote,
  QuoteButton: (props: QuoteProps) => {
    quoteProps = props;
    return realQuote.QuoteButton(props);
  },
}));
// The bar's props as the footer handed them, so the delete dialog it opens can be drawn here.
type BarProps = Parameters<
  typeof import("@/components/forum/content-actions").ContentActions
>[0];
let barProps: BarProps | undefined;
const realBar = { ...(await import("@/components/forum/content-actions")) };
mock.module("@/components/forum/content-actions", () => ({
  ...realBar,
  ContentActions: (props: BarProps) => {
    barProps = props;
    return realBar.ContentActions(props);
  },
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next-intl", () => intl);
  mock.module("@/components/forum/quote-button", () => realQuote);
  mock.module("@/components/forum/content-actions", () => realBar);
});

const { MessageActions } = await import("./message-actions");
const { DeleteDialog } = await import("@/components/forum/delete-dialog");

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
    canHardDelete: false,
    canReport: true,
    ...over,
  }) as Props["message"];

function draw(
  over: Record<string, unknown>,
  viewerId: number | null,
  canQuote = true,
) {
  return renderToStaticMarkup(
    withIntl(
      <MessageActions
        message={message(over)}
        viewerId={viewerId}
        canQuote={canQuote}
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
  // A private message has no share, as no permalink of it leaves the conversation.
  expect(has(html, "Share")).toBe(false);
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

test("an administrator may delete a message for good, also one that is already deleted", () => {
  // Live: the one Delete opens the dialog that holds both deletions.
  const live = draw({ canDelete: true, canHardDelete: true }, 9);
  expect(has(live, "Delete")).toBe(true);
  expect(has(live, "Delete permanently")).toBe(false);
  // Deleted: only the permanent delete is left.
  const deleted = draw({ state: "deleted", canHardDelete: true }, 9);
  expect(has(deleted, "Delete permanently")).toBe(true);
  expect(has(deleted, "Delete")).toBe(false);
  expect(has(draw({ state: "deleted" }, 9), "Delete permanently")).toBe(false);
});

test("report follows the backend's word, not the viewer being another participant", () => {
  expect(has(draw({}, 9), "Report")).toBe(true);
  expect(has(draw({ canReport: false }, 9), "Report")).toBe(false);
});

test("edit follows the backend's flag and opens the message's edit page", () => {
  const html = draw({ canEdit: true }, 3);
  expect(has(html, "Edit")).toBe(true);
  expect(html).toContain('href="/conversations/5/edit/11"');
  expect(has(draw({ canEdit: false }, 3), "Edit")).toBe(false);
});

test('a visible message has a thread post\'s "+ Quote" and Reply, on the right of report and edit', () => {
  const html = draw({ canEdit: true }, 9);
  expect(has(html, "Quote")).toBe(true);
  expect(html).toContain("+ Quote");
  expect(has(html, "Reply")).toBe(true);
  expect(html).toContain('href="#reply"');
  // As XenForo's footer: what the viewer does to the message first, how they answer it last.
  expect(html.indexOf('aria-label="Report"')).toBeLessThan(
    html.indexOf('aria-label="Quote"'),
  );
  expect(html.indexOf('aria-label="Edit"')).toBeLessThan(
    html.indexOf('aria-label="Quote"'),
  );
  expect(html.indexOf('aria-label="Quote"')).toBeLessThan(
    html.indexOf('aria-label="Reply"'),
  );
});

test("a message has neither Quote nor Reply where the viewer cannot reply, and no Quote when it is not visible", () => {
  const closed = draw({ canEdit: true }, 9, false);
  expect(has(closed, "Quote")).toBe(false);
  expect(has(closed, "Reply")).toBe(false);
  for (const state of ["moderated", "deleted"])
    expect(has(draw({ state }, 9), "Quote")).toBe(false);
});

test("Delete opens the one delete dialog, saying what each deletion of a message does", () => {
  barProps = undefined;
  draw({ canDelete: true, canHardDelete: true }, 9);
  // Set by the stand-in while drawing, which the compiler cannot follow.
  const remove = (barProps as BarProps | undefined)?.remove;
  if (!remove) throw new Error("the bar was given no delete");
  const html = renderToStaticMarkup(
    withIntl(
      <DeleteDialog
        open
        action={remove.action}
        permanent={remove.permanent}
        warning={remove.warning}
        permanentHint={remove.permanentHint}
      />,
    ),
  );
  expect(html).toContain("Remove from public view");
  expect(html).toContain("Delete permanently");
  expect(html).toContain("for the other participants too");
  expect(html).toContain('name="reason"');
});

test("a deleted message offers neither share, delete nor report", () => {
  const html = draw({ state: "deleted", canDelete: true }, 9);
  for (const label of ["Share", "Delete", "Report"]) {
    expect(has(html, label)).toBe(false);
  }
});

test("Quote puts the message in the editor quoted as a conversation message, not a post", async () => {
  quoteProps = undefined;
  draw({}, 9);
  // Set by the stand-in while drawing, which the compiler cannot follow.
  const drawn = quoteProps as QuoteProps | undefined;
  if (!drawn) throw new Error("the bar drew no quote button");
  const sent: string[] = [];
  const saved = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, {
    window: {
      dispatchEvent: (event: CustomEvent<string>) => sent.push(event.detail),
    },
    document: { getElementById: () => null },
  });
  try {
    // The source comes from the backend (`quoteMessageSource`); here, as it would answer.
    const button = realQuote.QuoteButton({
      ...drawn,
      load: async () => ({ author: "ember", authorId: 3, source: "Hi" }),
    });
    await (button.props as { onClick: () => Promise<void> }).onClick();
  } finally {
    Object.assign(globalThis, saved);
  }
  expect(sent).toEqual([
    '[QUOTE="ember, convMessage: 11, member: 3"]Hi[/QUOTE]',
  ]);
});
