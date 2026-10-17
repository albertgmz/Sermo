import { afterAll, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { installIntl } from "./intl-stand-ins";

const restoreIntl = await installIntl();
afterAll(restoreIntl);

const { PagedItems } = await import("./paged-items");

const draw = async (props: Partial<Parameters<typeof PagedItems>[0]>) =>
  renderToStaticMarkup(
    withIntl(
      await PagedItems({
        items: [{ id: 1, title: "Ada", href: "/admin/users/1" }],
        nextCursor: null,
        path: "/admin/users",
        params: {},
        label: "Members",
        empty: { title: "No members" },
        ...props,
      }),
    ),
  );

test("the rows are the panel's rows, with the filter form above them", async () => {
  const html = await draw({
    filters: <form aria-label="Filter">filters</form>,
  });
  expect(html).toContain('href="/admin/users/1">Ada</a>');
  expect(html).toContain("Ada");
  expect(html.indexOf("filters")).toBeLessThan(html.indexOf("Ada"));
  expect(html).not.toContain("<nav");
});

test("Next keeps the filters and carries the cursor; a later page offers the first one", async () => {
  const first = await draw({ params: { state: "valid" }, nextCursor: "c2" });
  expect(first).toContain('href="/admin/users?state=valid&amp;cursor=c2"');
  expect(first).toContain('rel="next"');
  expect(first).not.toContain("Back to the first page");
  const later = await draw({
    params: { state: "valid", cursor: "c2" },
    nextCursor: null,
  });
  expect(later).toContain("Back to the first page");
  expect(later).toContain('href="/admin/users?state=valid"');
  expect(later).not.toContain('rel="next"');
});

test("a list that shares its page pages under its own parameter and leaves the others alone", async () => {
  const html = await draw({
    path: "/admin/users/7/sanctions",
    params: { bans: "b1", warnings: "w1" },
    cursorParam: "bans",
    nextCursor: "b2",
  });
  expect(html).toContain("warnings=w1");
  expect(html).toContain("bans=b2");
  expect(html).not.toContain("bans=b1");
});

test("an empty page says so", async () => {
  const html = await draw({ items: [], empty: { title: "No members here" } });
  expect(html).toContain("No members here");
});
