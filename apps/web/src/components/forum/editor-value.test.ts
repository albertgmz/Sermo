import { expect, test } from "bun:test";
import { createEditor } from "lexical";
import { $exportBb, $replaceWithBb, BB_NODES } from "./bb-lexical";
import { sentText } from "./editor-value";

// What the editor writes for a text, as FormField reports it.
function wrote(text: string) {
  const editor = createEditor({
    nodes: BB_NODES,
    onError: (e) => {
      throw e;
    },
  });
  let out = "";
  editor.update(
    () => {
      $replaceWithBb(text);
      out = $exportBb();
    },
    { discrete: true },
  );
  return out;
}

test("the text an editor opened with is sent as it was given until it is changed", () => {
  const original = "[b]loose[/b]\n\n\n\ntext  ";
  const baseline = wrote(original);
  expect(baseline).not.toBe(original);
  // The first report, and the same text again after a toggle or a no-op update.
  expect(sentText(baseline, baseline, original)).toBe(original);
  // A change is sent as the editor writes it.
  const changed = wrote("[b]loose[/b]\n\ntext and more");
  expect(sentText(changed, baseline, original)).toBe(changed);
  // Put back as it was: sent as it was given again.
  expect(sentText(baseline, baseline, original)).toBe(original);
});

test("an editor that opened empty, or after a clear, sends what it writes", () => {
  expect(sentText("", "", undefined)).toBe("");
  expect(sentText("typed", "", undefined)).toBe("typed");
  // After a clear the original is forgotten: the old baseline is not what is sent.
  expect(sentText("[B]x[/B]", "[B]x[/B]", undefined)).toBe("[B]x[/B]");
});
