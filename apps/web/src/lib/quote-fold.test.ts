import { expect, test } from "bun:test";
import { foldNestedQuotes } from "./quote-fold";

const quote = (author: string, post: number, body: string) =>
  `<blockquote class="bb-quote quote" data-post-id="${post}"><cite class="bb-quote-author"><a href="/posts/${post}">${author}</a></cite>${body}</blockquote>`;

const fold = (cite: string, body: string) =>
  `<details class="bb-quote-fold"><summary class="bb-quote-fold-summary">${cite}<span class="bb-quote-fold-hint"></span></summary>${body}</details>`;

test("a quote directly in the post is left as stored", () => {
  const html = `<p>a</p>${quote("Ann", 1, "<p>one</p>")}<p>b</p>`;
  expect(foldNestedQuotes(html)).toBe(html);
});

test("the quotes of the 2nd and 3rd level fold, each keeping its header and link", () => {
  const html = quote(
    "Ann",
    1,
    `<p>one</p>${quote("Bob", 2, `<p>two</p>${quote("Cy", 3, "<p>three</p>")}`)}`,
  );
  const cite = (name: string, post: number) =>
    `<cite class="bb-quote-author"><a href="/posts/${post}">${name}</a></cite>`;
  const open = (post: number) =>
    `<blockquote class="bb-quote quote" data-post-id="${post}">`;
  expect(foldNestedQuotes(html)).toBe(
    `${open(1)}${cite("Ann", 1)}<p>one</p>` +
      `${open(2)}${fold(cite("Bob", 2), `<p>two</p>${open(3)}${fold(cite("Cy", 3), "<p>three</p>")}</blockquote>`)}</blockquote>` +
      "</blockquote>",
  );
});

test("a nested quote with no author folds with the label alone", () => {
  const html = `<blockquote class="bb-quote"><p>a</p><blockquote class="bb-quote"><p>b</p></blockquote></blockquote>`;
  expect(foldNestedQuotes(html)).toBe(
    `<blockquote class="bb-quote"><p>a</p><blockquote class="bb-quote">${fold("", "<p>b</p>")}</blockquote></blockquote>`,
  );
});

test("sibling quotes at the second level each fold, and the level counts down after one closes", () => {
  const html = `<blockquote class="bb-quote"><blockquote class="bb-quote"><p>x</p></blockquote><blockquote class="bb-quote"><p>y</p></blockquote></blockquote><blockquote class="bb-quote"><p>z</p></blockquote>`;
  const out = foldNestedQuotes(html);
  expect(out.match(/<details/g)?.length).toBe(2);
  expect(
    out.endsWith('<blockquote class="bb-quote"><p>z</p></blockquote>'),
  ).toBe(true);
});

test("html without quotes is returned untouched", () => {
  expect(foldNestedQuotes("<p>hi</p>")).toBe("<p>hi</p>");
});
