import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { SortLists } from "./sort-lists";

const item = (id: number, position: number, title: string) => ({
  id,
  position,
  title,
  description: "Forum",
});

test("every group is a list under one form and one save, with the numbers the action compares", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <SortLists
        action={async () => null}
        heading="Display order"
        groups={[
          {
            id: "top",
            heading: "Top level",
            items: [item(1, 10, "News"), item(2, 20, "Help")],
          },
          {
            id: "2",
            heading: "Under Help",
            items: [item(3, 5, "Setup"), item(4, 5, "Billing")],
          },
        ]}
      />,
    ),
  );
  expect(html.match(/<form/g)?.length).toBe(1);
  expect(html.match(/type="submit"/g)?.length).toBe(1);
  expect(html.match(/<ol/g)?.length).toBe(2);
  expect(html).toContain("Top level");
  expect(html).toContain("Under Help");
  for (const [id, position] of [
    [1, 10],
    [2, 20],
    [3, 5],
    [4, 5],
  ]) {
    expect(html).toContain(`name="position:${id}" value="${position}"`);
    expect(html).toContain(`name="before:${id}" value="${position}"`);
  }
  expect(html).toContain('name="title:3" value="Setup"');
  expect(html).toContain('aria-label="Move Billing up"');
});
