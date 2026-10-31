import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

// The segment the address names under the layout that draws the bar, as the router says it.
let segment: string | null = null;
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useSelectedLayoutSegment: () => segment,
}));
// Whether the link a hint sits in is being followed, as `next/link` says it.
let pending = false;
const link = await import("next/link");
mock.module("next/link", () => ({
  ...link,
  useLinkStatus: () => ({ pending }),
}));
afterAll(() => {
  mock.module("next/navigation", () => navigation);
  mock.module("next/link", () => link);
});

const { SegmentTabLinks } = await import("./segment-tab-links");

const TABS = [
  { value: "", label: "Wall", href: "/members/5-wren" },
  { value: "posts", label: "Posts", href: "/members/5-wren/posts", count: 3 },
  { value: "threads", label: "Threads", href: "/members/5-wren/threads" },
  { value: "about", label: "About", href: "/members/5-wren/about" },
];

function open(at: string | null) {
  segment = at;
  const html = renderToStaticMarkup(
    withIntl(<SegmentTabLinks tabs={TABS} label="Profile sections" />),
  );
  return [...html.matchAll(/<a [^>]*>/g)]
    .filter(([link]) => link.includes('aria-current="page"'))
    .map(([link]) => /href="([^"]*)"/.exec(link)?.[1]);
}

test("the tab of the segment the address names is the open one, and only it", () => {
  expect(open("posts")).toEqual(["/members/5-wren/posts"]);
  expect(open("threads")).toEqual(["/members/5-wren/threads"]);
  expect(open("about")).toEqual(["/members/5-wren/about"]);
});

test("the layout's own page (no segment under it) is the tab with no segment", () => {
  expect(open(null)).toEqual(["/members/5-wren"]);
});

test("a segment no tab names opens none", () => {
  expect(open("elsewhere")).toEqual([]);
});

test("every tab is a plain link to its page, in a named navigation", () => {
  segment = null;
  const html = renderToStaticMarkup(
    withIntl(<SegmentTabLinks tabs={TABS} label="Profile sections" />),
  );
  expect(html).toContain('<nav aria-label="Profile sections"');
  for (const { href } of TABS) expect(html).toContain(`href="${href}"`);
  expect(html).not.toContain("<button");
});

test("a tab being followed is marked at once, before its page has come", () => {
  segment = null;
  const draw = () =>
    renderToStaticMarkup(
      withIntl(<SegmentTabLinks tabs={TABS} label="Profile sections" />),
    );
  pending = false;
  expect(draw()).not.toContain("<span hidden");
  pending = true;
  const html = draw();
  // In every link (the hook answers for the link it sits in), hidden from the page.
  expect(html.match(/<span hidden="" data-tab-pending="">/g)).toHaveLength(
    TABS.length,
  );
  // The bar draws a pending link as the open one.
  expect(html).toMatch(/<nav [^>]*class="[^"]*has-\[\[data-tab-pending\]\]/);
  pending = false;
});
