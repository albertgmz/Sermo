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

test("the menu button at the bar's end shows its label as plain text, with no icon", () => {
  const wide = draw({ more: [tab("media")], moreLabel: "More" });
  expect(wide).toContain(">More<");
  expect(wide).not.toContain("lucide-ellipsis");
  expect(wide).not.toContain("title=");
});
