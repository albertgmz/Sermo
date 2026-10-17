import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { SortForm } from "./sort-form";

const action = async () => null;

test("every entry in order with its position under the action's own field name, and one save", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <SortForm
        action={action}
        name="position:{id}"
        heading="Categories"
        items={[
          {
            id: 4,
            title: "Frames",
            position: 10,
            fields: { "before:4": 10, "title:4": "Frames" },
          },
          { id: 9, title: "Covers", position: 20, description: "Profile" },
        ]}
      />,
    ),
  );
  expect(html).toContain("<ol");
  expect(html).toContain('name="position:4" value="10"');
  expect(html).toContain('name="position:9" value="20"');
  expect(html).toContain('name="before:4" value="10"');
  expect(html).toContain('name="title:4" value="Frames"');
  expect(html.indexOf("Frames")).toBeLessThan(html.indexOf("Covers"));
  expect(html).toContain("Profile");
  expect(html).toContain('aria-label="Move Frames up"');
  expect(html).toContain('aria-label="Move Covers down"');
  // The arrows at the ends stay focusable, marked disabled.
  const arrow = (label: string) =>
    new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(html)?.[0];
  expect(arrow("Move Frames up")).toContain('aria-disabled="true"');
  expect(arrow("Move Covers down")).toContain('aria-disabled="true"');
  expect(arrow("Move Frames down")).not.toContain("aria-disabled=");
  expect(arrow("Move Frames up")).not.toContain(" disabled=");
  expect(html.match(/type="submit"/g)?.length).toBe(1);
  expect(html).toContain("Save order");
  expect(html).not.toContain("draggable");
});
