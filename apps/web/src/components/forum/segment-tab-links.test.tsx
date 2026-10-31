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
  // The bar draws a pending link as the open one, and the open one no longer so: one tab looks open.
  const nav = /<nav [^>]*class="([^"]*)"/.exec(html)?.[1].split(" ") ?? [];
  expect(nav).toContain("*:has-[[data-tab-pending]]:border-primary");
  expect(nav).toContain(
    "has-[[data-tab-pending]]:*:aria-[current=page]:not-has-[[data-tab-pending]]:border-transparent",
  );
  expect(nav).toContain(
    "has-[[data-tab-pending]]:*:aria-[current=page]:not-has-[[data-tab-pending]]:text-muted-foreground",
  );
  pending = false;
});

test("a segmented bar resets the open tab's background while another is pending", () => {
  segment = null;
  const html = renderToStaticMarkup(
    withIntl(
      <SegmentTabLinks
        tabs={TABS}
        label="Profile sections"
        variant="segmented"
      />,
    ),
  );
  const nav = /<nav [^>]*class="([^"]*)"/.exec(html)?.[1].split(" ") ?? [];
  expect(nav).toContain("*:has-[[data-tab-pending]]:bg-muted");
  expect(nav).toContain(
    "has-[[data-tab-pending]]:*:aria-[current=page]:not-has-[[data-tab-pending]]:bg-transparent",
  );
});

// A screen reader hears the tab that opened: the bar says it in a polite live region that is on
// the page from the start, whenever the page's title is set.
test("the open tab is said in a live region beside the bar", () => {
  const status = (at: string | null) => {
    segment = at;
    const html = renderToStaticMarkup(
      withIntl(<SegmentTabLinks tabs={TABS} label="Profile sections" />),
    );
    return /<span role="status" class="sr-only">([^<]*)<\/span>/.exec(
      html,
    )?.[1];
  };
  expect(status(null)).toBe("Wall");
  expect(status("about")).toBe("About");
  expect(status("elsewhere")).toBe("");
});
