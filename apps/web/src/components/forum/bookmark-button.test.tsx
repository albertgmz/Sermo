import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useRouter: () => ({ push: () => {} }),
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
});
const { BookmarkButton, BookmarkRefusal } = await import("./bookmark-button");

test("a refusal takes its own line under the button by default", () => {
  const html = renderToStaticMarkup(
    <BookmarkRefusal floating={false}>Could not save</BookmarkRefusal>,
  );
  expect(html).toContain('role="alert"');
  expect(html).not.toContain("absolute");
});

test("in a row of small controls the refusal floats under the button and does not widen the row", () => {
  const html = renderToStaticMarkup(
    <BookmarkRefusal floating>Could not save</BookmarkRefusal>,
  );
  expect(html).toContain("absolute top-full right-0");
  expect(html).toContain("w-max max-w-64");
});

test("the button that hosts a floating refusal is its anchor and keeps its width", () => {
  const draw = (floatingError: boolean) =>
    renderToStaticMarkup(
      withIntl(
        <BookmarkButton
          contentType="post"
          contentId={1}
          bookmarked={false}
          floatingError={floatingError}
        />,
      ),
    );
  expect(draw(true)).toContain(
    'class="flex min-w-0 max-w-full flex-col relative shrink-0"',
  );
  expect(draw(false)).toContain('class="flex min-w-0 max-w-full flex-col"');
});
