import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { TabLinks } from "./tab-links";

const tab = (value: string) => ({
  value,
  label: value.toUpperCase(),
  href: `/?tab=${value}`,
});

const draw = (props: Partial<Parameters<typeof TabLinks>[0]> = {}) =>
  renderToStaticMarkup(
    withIntl(
      <TabLinks
        tabs={[tab("latest"), tab("hot")]}
        active="hot"
        label="Home"
        {...props}
      />,
    ),
  );

test("the tabs are links, and the active one says so", () => {
  const html = draw();
  expect(html).toContain('href="/?tab=latest"');
  expect(html).toContain('href="/?tab=hot"');
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).not.toContain("<button");
});

test("tabs that do not fit are behind a menu button at the end of the bar", () => {
  const html = draw({
    more: [tab("forums"), tab("media")],
    moreLabel: "More",
  });
  expect(html).toContain("<button");
  expect(html).toContain("More");
  expect(html.lastIndexOf("<button")).toBeGreaterThan(
    html.lastIndexOf('href="/?tab=hot"'),
  );
  // The menu is closed: its entries are not in the page until it opens.
  expect(html).not.toContain('href="/?tab=forums"');
});

test("with nothing to put in the menu there is no menu button", () => {
  expect(draw({ more: [], moreLabel: "More" })).not.toContain("<button");
  expect(draw({ moreLabel: "More" })).not.toContain("<button");
});

test("a tab never breaks its label over two lines", () => {
  const html = draw();
  expect(html.match(/whitespace-nowrap/g)).toHaveLength(2);
});

test("a segmented bar wider than the screen scrolls sideways instead of pushing the page", () => {
  const nav = draw({ variant: "segmented" }).match(/<nav [^>]*class="([^"]*)"/);
  const classes = nav?.[1].split(" ") ?? [];
  expect(classes).toContain("overflow-x-auto");
  expect(classes).toContain("max-w-full");
});

test("narrow, only the open tab shows its label on a phone; the others keep it as their name", () => {
  const html = draw({
    tabs: [
      { ...tab("latest"), icon: <svg aria-hidden="true" /> },
      { ...tab("hot"), icon: <svg aria-hidden="true" /> },
    ],
    narrow: true,
  });
  // The open tab's label is plain text; the other one's is for assistive technology below `sm`.
  expect(html).toContain('<span class="max-sm:sr-only">LATEST</span>');
  expect(html).not.toContain('<span class="max-sm:sr-only">HOT</span>');
  expect(html).toMatch(
    /aria-current="page"[^>]*><svg aria-hidden="true"><\/svg>HOT<\/a>/,
  );
  // A label inside a link that hides it is placed against the link.
  expect(html.match(/class="[^"]*\brelative\b/g)).toHaveLength(2);
  // A tab drawn as its icon names itself on hover; the open one shows its label already.
  expect(html).toContain('title="LATEST"');
  expect(html).not.toContain('title="HOT"');
  expect(draw()).not.toContain("title=");
});

test("narrow, the menu button is an icon named by its label on a phone", () => {
  const html = draw({
    more: [tab("media")],
    moreLabel: "More",
    narrow: true,
  });
  const button = html.slice(html.lastIndexOf("<button"));
  expect(button).toContain('<span class="max-sm:sr-only">More</span>');
  expect(button).toContain("lucide-ellipsis");
  expect(button).toContain('title="More"');
  // Not narrow, the label is plain text and there is no icon.
  const wide = draw({ more: [tab("media")], moreLabel: "More" });
  expect(wide).toContain(">More<");
  expect(wide).not.toContain("lucide-ellipsis");
  expect(wide).not.toContain("title=");
});
