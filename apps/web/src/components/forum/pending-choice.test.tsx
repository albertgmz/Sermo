import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useSearchParams: () => new URLSearchParams("prefix=3"),
}));
afterAll(() => mock.module("next/navigation", () => navigation));

const { PendingChoice } = await import("./pending-choice");

test("the part is not busy until a choice is pressed, and holds what it is given", () => {
  const html = renderToStaticMarkup(
    <PendingChoice>
      <p>list</p>
    </PendingChoice>,
  );
  expect(html).not.toContain('aria-busy="true"');
  expect(html).toContain("<p>list</p>");
});
