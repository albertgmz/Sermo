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
