import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { plainExcerpt } = await import("./content");

test("the excerpt is the text of the HTML, without tags or markup entities", () => {
  expect(
    plainExcerpt("<p>Fish &amp; <strong>chips</strong></p><p>tonight</p>"),
  ).toBe("Fish & chips tonight");
});

test("a long text is cut at the length with an ellipsis", () => {
  const cut = plainExcerpt(`<p>${"word ".repeat(100)}</p>`, 20);
  expect(cut.endsWith("…")).toBe(true);
  expect(cut.length).toBeLessThanOrEqual(21);
});
