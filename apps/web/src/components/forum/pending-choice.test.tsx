import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useSearchParams: () => new URLSearchParams("prefix=3"),
}));
afterAll(() => mock.module("next/navigation", () => navigation));

const { PendingChoice, chosenQuery } = await import("./pending-choice");

const here = new URL("http://site.test/forums/2?prefix=3&page=2");
const plain = { newTab: false, inMenu: true };

test("a menu choice that opens this page with another query is a choice, named by its query", () => {
  expect(chosenQuery("/forums/2?prefix=5", here, plain)).toBe("prefix=5");
  expect(chosenQuery("/forums/2", here, plain)).toBe("");
});

test("anything else is not a choice", () => {
  // Another page, another site, a new tab, a link outside the menu (a pager, a thread).
  expect(chosenQuery("/threads/8", here, plain)).toBeNull();
  expect(
    chosenQuery("http://other.test/forums/2?prefix=5", here, plain),
  ).toBeNull();
  expect(
    chosenQuery("/forums/2?prefix=5", here, { ...plain, newTab: true }),
  ).toBeNull();
  expect(
    chosenQuery("/forums/2?page=3", here, { ...plain, inMenu: false }),
  ).toBeNull();
});

test("the part is not busy until a choice is pressed", () => {
  const html = renderToStaticMarkup(
    <PendingChoice>
      <p>list</p>
    </PendingChoice>,
  );
  expect(html).not.toContain('aria-busy="true"');
  expect(html).toContain("<p>list</p>");
});
