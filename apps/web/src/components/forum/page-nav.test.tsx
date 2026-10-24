import { expect, test } from "bun:test";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { PageNav } from "./page-nav";

const draw = (props: Partial<ComponentProps<typeof PageNav>> = {}) =>
  renderToStaticMarkup(
    withIntl(<PageNav page={34} pages={68} path="/threads/7" {...props} />),
  );

const pageLinks = (html: string) =>
  [...html.matchAll(/<a href="([^"]*)" data-page="(\d+)"/g)].map(
    ([, href, page]) => ({ href: href.replaceAll("&amp;", "&"), page }),
  );

test("a list of one page has no pager", () => {
  expect(draw({ page: 1, pages: 1 })).toBe("");
});

test("every page is a plain link to its address, the current one marked", () => {
  const html = draw();
  const links = pageLinks(html);
  // Previous, then the pages of both windows, then next.
  expect(links[0]).toEqual({ href: "/threads/7?page=33", page: "33" });
  expect(links.at(-1)).toEqual({ href: "/threads/7?page=35", page: "35" });
  expect(links.map((link) => link.page)).toContain("1");
  expect(links.map((link) => link.page)).toContain("68");
  expect(links.find((link) => link.page === "1")?.href).toBe("/threads/7");
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toMatch(/aria-current="page"[^>]*>34</);
  expect(html).toContain('rel="prev"');
  expect(html).toContain('rel="next"');
});

test("the first page has no previous link and the last no next link", () => {
  expect(draw({ page: 1 })).not.toContain('rel="prev"');
  expect(draw({ page: 68 })).not.toContain('rel="next"');
});

test("the list's other parameters stay on every page's address and in the jump form", () => {
  const html = draw({ params: { select: "1", page: "34" } });
  for (const link of pageLinks(html)) {
    expect(link.href).toStartWith("/threads/7?select=1");
  }
  expect(html).toContain('<input type="hidden" name="select" value="1"/>');
  // The page parameter is the number box's, not a hidden one.
  expect(html).not.toContain('type="hidden" name="page"');
});

test("a skip opens 'go to page', a form that works without scripts", () => {
  const html = draw();
  const forms = [...html.matchAll(/<form[^>]* action="([^"]*)" method="get"/g)];
  // One before the window and one after it for each screen: a phone's window is a page narrower
  // on each side.
  expect(forms.map((form) => form[1])).toEqual([
    "/threads/7",
    "/threads/7",
    "/threads/7",
    "/threads/7",
  ]);
  expect(html.match(/<details/g)).toHaveLength(4);
  expect(html).toContain('title="Go to page"');
  const boxes = [...html.matchAll(/<input[^>]*type="number"[^>]*>/g)].map(
    (box) => box[0],
  );
  expect(boxes).toHaveLength(4);
  for (const box of boxes) {
    expect(box).toContain('name="page"');
    expect(box).toContain('min="1"');
    expect(box).toContain('max="68"');
    expect(box).toContain("required");
  }
  // Filled with the page next to the window on its side: the phone's (32, 36), the wide one's
  // (31, 37).
  expect(boxes.map((box) => box.match(/value="(\d+)"/)?.[1])).toEqual([
    "32",
    "31",
    "36",
    "37",
  ]);
  expect(html).toContain('data-page-go="68"');
});

test("a phone hides the pages only the wide window has", () => {
  const html = draw();
  // 32 and 36 are wide only; 33 to 35 show on both.
  expect(html).toMatch(
    /<li class="max-sm:hidden"><a href="\/threads\/7\?page=32"/,
  );
  expect(html).toMatch(/<li><a href="\/threads\/7\?page=33"/);
});

test("past the last numbered page a moderator's list goes on by the address it is given", () => {
  const html = draw({
    page: 3,
    pages: 3,
    next: "/threads/7?page=4&cursor=abc",
  });
  expect(html).toContain('href="/threads/7?page=4&amp;cursor=abc"');
  // That link is followed as a link, not turned in place.
  expect(html).not.toContain('data-page="4"');
});
