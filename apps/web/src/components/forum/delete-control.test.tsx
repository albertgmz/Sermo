import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeleteControl } from "./delete-control";

const action = async () => ({});

test("the control shows only the button that opens the step, never the form", () => {
  const html = renderToStaticMarkup(
    <DeleteControl
      action={action}
      label="Remove the cover"
      confirm="Remove it"
      cancel="Cancel"
      warning="Nothing is refunded."
    >
      <input name="extra" />
    </DeleteControl>,
  );
  expect(html).toContain("Remove the cover");
  expect(html).not.toContain("<form");
  expect(html).not.toContain("Remove it");
  expect(html).not.toContain('name="extra"');
});
