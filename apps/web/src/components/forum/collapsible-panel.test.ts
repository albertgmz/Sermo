import { expect, test } from "bun:test";
import { foldPanel } from "./collapsible-panel";

function body() {
  const attributes = new Map<string, string>();
  return {
    attributes,
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    removeAttribute: (name: string) => {
      attributes.delete(name);
    },
  };
}

test("a closed panel's body is hidden until the browser's find reaches it, an open one is shown", () => {
  const panel = body();
  foldPanel(panel, true);
  expect(panel.attributes.get("hidden")).toBe("until-found");
  foldPanel(panel, false);
  expect(panel.attributes.has("hidden")).toBe(false);
});
