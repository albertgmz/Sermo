import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";
import { ICON_ENTRIES, searchIcons } from "./icon-meta";
import { IconGrid, IconPicker } from "./icon-picker";

const render = (node: React.ReactNode) => renderToStaticMarkup(withIntl(node));

test("the hidden input carries the key the picker starts with", () => {
  const html = render(<IconPicker name="icon" defaultValue="gamepad-2" />);
  expect(html).toContain('type="hidden"');
  expect(html).toContain('name="icon"');
  expect(html).toContain('value="gamepad-2"');
  expect(html).toContain("Gamepad");
});

test("without a key, the input is empty and the trigger says no icon", () => {
  for (const html of [
    render(<IconPicker name="icon" />),
    render(<IconPicker name="icon" defaultValue={null} />),
    render(<IconPicker name="icon" defaultValue="" />),
  ]) {
    expect(html).toContain('name="icon" value=""');
    expect(html).toContain("No icon");
  }
});

test("a key the set does not know is kept in the input and shown as text", () => {
  const html = render(<IconPicker name="icon" defaultValue="retired-icon" />);
  expect(html).toContain('value="retired-icon"');
  expect(html).toContain("retired-icon");
});

test("the trigger takes the id of its label", () => {
  const html = render(<IconPicker name="icon" id="node-icon" />);
  expect(html).toMatch(/<button[^>]*id="node-icon"/);
});

test("the grid has a named button for each icon and marks the chosen one", () => {
  const html = render(
    <IconGrid entries={ICON_ENTRIES} value="star" onChoose={() => {}} />,
  );
  expect(html.match(/<button/g)).toHaveLength(ICON_ENTRIES.length);
  expect(html).toContain('aria-label="Star"');
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  expect(html).toMatch(/aria-label="Star"[^>]*aria-pressed="true"/);
  for (const button of html.match(/<button[^>]*>/g) ?? [])
    expect(button).toContain("size-10");
});

test("a search narrows the grid and a search with no match says so", () => {
  const found = searchIcons("pets");
  const some = render(
    <IconGrid entries={found} value={null} onChoose={() => {}} />,
  );
  expect(some.match(/<button/g)).toHaveLength(found.length);
  expect(some).toContain('aria-label="Dog"');
  expect(some).not.toContain('aria-label="Star"');
  const none = render(
    <IconGrid entries={searchIcons("zzzz")} value={null} onChoose={() => {}} />,
  );
  expect(none).not.toContain("<button");
  expect(none).toContain("No icon matches that search.");
});
