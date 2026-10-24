import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { ThreadFields } from "./thread-fields";

const PREFIXES = [
  { id: 7, label: "Solved", color: "#22aa66", icon: "circle-check" },
];

const draw = (mustHavePrefix: boolean, prefixId: string) =>
  renderToStaticMarkup(
    withIntl(
      <ThreadFields
        prefixes={PREFIXES}
        prefixId={prefixId}
        title="A title"
        mustHavePrefix={mustHavePrefix}
      />,
    ),
  );

test("the form offers 'No prefix' unless the forum does not let the author take the prefix off", () => {
  expect(draw(false, "")).toContain("No prefix");
  expect(draw(false, "7")).not.toContain("No prefix");
  // The choice that is not there cannot be the one shown.
  expect(draw(true, "7")).not.toContain("No prefix");
  expect(draw(true, "7")).toContain("Solved");
});

test("the prefix is a menu joined to the left of the title, in one field, as XenForo's title row", () => {
  const html = draw(false, "7");
  const group = html.indexOf("focus-within:ring-3");
  const prefix = html.indexOf('aria-label="Prefix: Solved"');
  const title = html.indexOf('name="title"');
  expect(group).toBeGreaterThan(-1);
  expect(group).toBeLessThan(prefix);
  expect(prefix).toBeLessThan(title);
  expect(html).toContain('aria-haspopup="menu"');
  // The chosen prefix is drawn as its coloured label in the button.
  expect(html).toContain("--prefix-color:#22aa66");
  // What the form sends.
  expect(html).toContain('type="hidden" name="prefixId" value="7"');
  expect(html).toContain('value="A title"');
});

test("a forum that offers no prefix draws the title alone, and the form keeps sending no prefix", () => {
  const html = renderToStaticMarkup(
    withIntl(<ThreadFields prefixes={[]} title="A title" />),
  );
  expect(html).not.toContain('aria-haspopup="menu"');
  expect(html).toContain('type="hidden" name="prefixId" value=""');
  expect(html).toContain('placeholder="Title…"');
});
