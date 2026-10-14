import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
import { labelledIcons, searchIcons } from "./icon-meta";
import { IconGrid, IconPicker } from "./icon-picker";

const ENTRIES = labelledIcons((key) => messages.ui.iconPicker.labels[key]);
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

test("with a label id, the trigger is named by the label and the chosen icon together", () => {
  const html = render(
    <>
      <label id="icon-label" htmlFor="node-icon">
        Icon
      </label>
      <IconPicker
        name="icon"
        id="node-icon"
        labelId="icon-label"
        defaultValue="gamepad-2"
      />
    </>,
  );
  const named = html.match(/<button[^>]*aria-labelledby="([^"]+)"/)?.[1];
  const [label, value] = (named ?? "").split(" ");
  expect(label).toBe("icon-label");
  expect(value).toBeTruthy();
  // Both ids exist in the page and the value is the text of the chosen icon.
  expect(html).toContain(`id="${value}"`);
  expect(html).toMatch(new RegExp(`id="${value}"[^>]*>.*Gamepad`));
  expect(render(<IconPicker name="icon" id="node-icon" />)).not.toContain(
    "aria-labelledby",
  );
});

test("the grid has a named button for each icon and marks the chosen one", () => {
  const html = render(
    <IconGrid entries={ENTRIES} value="star" onChoose={() => {}} />,
  );
  expect(html.match(/<button/g)).toHaveLength(ENTRIES.length);
  expect(html).toContain('aria-label="Star"');
  expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  expect(html).toMatch(/aria-label="Star"[^>]*aria-pressed="true"/);
  for (const button of html.match(/<button[^>]*>/g) ?? [])
    expect(button).toContain("size-10");
});

test("a search narrows the grid and a search with no match says so", () => {
  const found = searchIcons("pets", ENTRIES);
  const some = render(
    <IconGrid entries={found} value={null} onChoose={() => {}} />,
  );
  expect(some.match(/<button/g)).toHaveLength(found.length);
  expect(some).toContain('aria-label="Dog"');
  expect(some).not.toContain('aria-label="Star"');
  const none = render(
    <IconGrid
      entries={searchIcons("zzzz", ENTRIES)}
      value={null}
      onChoose={() => {}}
    />,
  );
  expect(none).not.toContain("<button");
  expect(none).toContain("No icon matches that search.");
});
