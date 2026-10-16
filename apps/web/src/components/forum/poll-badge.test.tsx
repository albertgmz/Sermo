import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { messageActionClass } from "./message-action";

const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
  useFormatter: useIntl.useFormatter,
}));

const { PollBadge } = await import("./poll-badge");
const { FirstUnreadLink } = await import("./first-unread-link");

test("a poll and a quiz are told apart in words, not by the icon alone", () => {
  expect(renderToStaticMarkup(withIntl(<PollBadge kind="poll" />))).toContain(
    "Poll",
  );
  expect(renderToStaticMarkup(withIntl(<PollBadge kind="quiz" />))).toContain(
    "Quiz",
  );
});

test("the unread link is a full-size action that names where it goes", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <FirstUnreadLink href="/threads/7#post-9" count={12} more={false} />,
    ),
  );
  expect(html).toContain('href="/threads/7#post-9"');
  expect(html).toContain('aria-label="Jump to the first of 12 unread posts"');
  expect(html).toContain("12 new");
  expect(html).toContain("text-primary-ink");
  expect(messageActionClass).toContain("h-10");
});

test("a count past the cap reads 99+, and a single post is not counted", () => {
  const capped = renderToStaticMarkup(
    withIntl(<FirstUnreadLink href="/t" count={99} more />),
  );
  expect(capped).toContain("99+ new");
  const one = renderToStaticMarkup(
    withIntl(<FirstUnreadLink href="/t" count={1} more={false} />),
  );
  expect(one).toContain('aria-label="Jump to the unread post"');
});
