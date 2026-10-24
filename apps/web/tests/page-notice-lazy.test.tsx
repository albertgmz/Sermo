import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// The card of a notice is fetched with the first notice. Until it is there the words are in the
// live region, and nothing is drawn in the page's flow; if it cannot be fetched they stay there.

const real = { ...(await import("@/components/forum/notice-card")) };
mock.module("@/components/forum/notice-card", () => real);
afterAll(() => {
  mock.module("@/components/forum/notice-card", () => real);
});

const { cardOrNothing, NoticeView } = await import(
  "@/components/forum/page-notice"
);
const settle = () => new Promise((done) => setTimeout(done, 20));

test("a notice said before the card's code is there is already in the live region", async () => {
  const before = renderToStaticMarkup(
    withIntl(<NoticeView text="Bought." seq={1} />),
  );
  expect(before).toMatch(
    /<output aria-live="polite"[^>]*><span>Bought\.<\/span><\/output>/,
  );
  expect(before).not.toContain("<button");
  await settle();
  const after = renderToStaticMarkup(
    withIntl(<NoticeView text="Bought." seq={1} />),
  );
  // The card floats (fixed), the live region is still the one that is read.
  expect(after).toContain("fixed");
  expect(after).toContain('aria-label="Dismiss notice"');
  expect(after).toMatch(
    /<output aria-live="polite"[^>]*><span>Bought\.<\/span><\/output>/,
  );
});

test("with no notice nothing but the empty live region is drawn", () => {
  expect(
    renderToStaticMarkup(withIntl(<NoticeView text={null} seq={0} />)),
  ).toBe('<output aria-live="polite" class="sr-only"></output>');
});

test("a card that cannot be fetched is answered with one that draws nothing, not with an error", async () => {
  const { default: Card } = await cardOrNothing(() =>
    Promise.reject(new Error("chunk failed")),
  );
  expect(renderToStaticMarkup(<Card text="Bought." />)).toBe("");
});
