import { afterAll, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { installIntl } from "@/app/[locale]/(staff)/admin/users/intl-stand-ins";
import { withIntl } from "@/lib/test-intl";

const restoreIntl = await installIntl();
afterAll(restoreIntl);

const { PagedList } = await import("./paged-list");

type Props = Parameters<typeof PagedList>[0];

const draw = ({
  paging,
  ...props
}: Partial<Omit<Props, "paging">> & {
  paging?: Partial<NonNullable<Props["paging"]>>;
}) =>
  renderToStaticMarkup(
    withIntl(
      <PagedList
        items={[{ id: 1, title: "Ada", href: "/admin/users/1" }]}
        label="Members"
        empty={{ title: "No members" }}
        {...props}
        paging={{
          path: "/admin/users",
          params: {},
          nextCursor: null,
          ...paging,
        }}
      />,
    ),
  );

test("the rows are the panel's rows, with the filter form above them", () => {
  const html = draw({ filters: <form aria-label="Filter">filters</form> });
  expect(html).toContain('href="/admin/users/1">Ada</a>');
  expect(html.indexOf("filters")).toBeLessThan(html.indexOf("Ada"));
  expect(html).not.toContain("<nav");
  // One page only: the count is the whole list.
  expect(html).toContain("Showing 1 entry");
});

test("Next keeps the filters and carries the cursor; a later page offers the first one", () => {
  const first = draw({
    paging: { params: { state: "valid" }, nextCursor: "c2" },
  });
  expect(first).toContain('href="/admin/users?state=valid&amp;cursor=c2"');
  expect(first).toContain('rel="next"');
  expect(first).not.toContain("Back to the first page");
  // More than one page: the count is this page's, not a total.
  expect(first).toContain("1 entry on this page");
  expect(first).not.toContain("Showing 1 entry");
  const later = draw({
    paging: { params: { state: "valid", cursor: "c2" }, nextCursor: null },
  });
  expect(later).toContain("Back to the first page");
  expect(later).toContain('href="/admin/users?state=valid"');
  expect(later).not.toContain('rel="next"');
});

test("a save's notice stays on the page it was shown on", () => {
  const html = draw({
    paging: { params: { notice: "banned", cursor: "c2" }, nextCursor: "c3" },
  });
  expect(html).toContain('href="/admin/users?cursor=c3"');
  expect(html).toContain('href="/admin/users"');
  expect(html).not.toContain("notice=");
});

test("a list that shares its page pages under its own parameter and leaves the others alone", () => {
  const html = draw({
    paging: {
      path: "/admin/users/7/sanctions",
      params: { bans: "b1", warnings: "w1" },
      cursorParam: "bans",
      nextCursor: "b2",
    },
  });
  expect(html).toContain("warnings=w1");
  expect(html).toContain("bans=b2");
  expect(html).not.toContain("bans=b1");
});

test("an empty later page says so and still leads back to the first one", () => {
  const html = draw({
    items: [],
    empty: { title: "No members here" },
    paging: { params: { cursor: "c9" } },
  });
  expect(html).toContain("No members here");
  expect(html).toContain("Back to the first page");
});
