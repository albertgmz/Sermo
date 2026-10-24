import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import type { Filters } from "./filters";
import { SearchForm } from "./search-form";

const filters: Filters = {
  query: "tomates",
  author: "ember",
  titlesOnly: false,
  forum: undefined,
  prefix: undefined,
};

const draw = (override: Partial<Filters> = {}) =>
  renderToStaticMarkup(
    withIntl(
      <SearchForm
        filters={{ ...filters, ...override }}
        nodes={[{ id: 2, title: "General", depth: 0 } as never]}
        prefixes={[]}
      />,
    ),
  );

test("the member filter is a picker: the chosen member is a chip and their name goes in the address", () => {
  const html = draw();
  expect(html).toContain('<input type="hidden" name="author" value="ember"');
  expect(html).toContain('aria-label="Remove ember"');
});

test("the member filter is a labelled box that sends what was typed", () => {
  const html = draw({ author: "" });
  const forId = html.match(/<label[^>]*for="([^"]+)"[^>]*>By member<\/label>/);
  const box = html.match(/<input[^>]*type="search"[^>]*name="author"[^>]*>/);
  expect(forId?.[1]).toBeTruthy();
  expect(box?.[0]).toContain(`id="${forId?.[1]}"`);
});

test("Forum and Prefix are labels of their selects, so pressing one focuses its select", () => {
  const html = draw();
  for (const text of ["Forum", "Prefix"]) {
    // Base UI's select label: it names the trigger and focuses it on a press.
    expect(html).toMatch(
      new RegExp(`<div[^>]*id="[^"]+-label"[^>]*>${text}</div>`),
    );
  }
});
