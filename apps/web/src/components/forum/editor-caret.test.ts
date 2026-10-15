import { expect, test } from "bun:test";
import { $getSelection, $isRangeSelection, createEditor } from "lexical";
import { $replaceWithBb, BB_NODES } from "./bb-lexical";
import { $placeSelection, charsBefore } from "./editor-caret";

// The text before the caret of the editor, once the selection is placed.
function placed(source: string, start: number, end = start) {
  const editor = createEditor({
    nodes: BB_NODES,
    onError: (e) => {
      throw e;
    },
  });
  let out: { before: string; selected: string } | undefined;
  editor.update(
    () => {
      $replaceWithBb(source);
      $placeSelection(source, start, end);
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const text = selection.anchor.getNode().getTextContent();
      out = {
        before: text.slice(0, selection.anchor.offset),
        selected: selection.getTextContent(),
      };
    },
    { discrete: true },
  );
  return out;
}

const SOURCE =
  "Hello [B]bold [I]words[/I][/B] and\n\n[LIST]\n[*]one\n[*]two three\n[/LIST]";

test("characters of text are counted without the tags and the spaces", () => {
  expect(charsBefore(SOURCE, 0)).toBe(0);
  expect(charsBefore(SOURCE, 5)).toBe(5);
  // After "Hello [B]bo": the tag is not counted.
  expect(charsBefore(SOURCE, 11)).toBe(7);
  // In the middle of a tag nothing of it counts.
  expect(charsBefore(SOURCE, 8)).toBe(5);
});

test("the caret lands after the same text it was after in the box", () => {
  // After "Hello [B]bol".
  expect(placed(SOURCE, 12)?.before.endsWith("bol")).toBe(true);
  // Inside a word in the last item.
  const at = SOURCE.indexOf("thr") + 3;
  expect(placed(SOURCE, at)?.before).toBe("two thr");
  // At the start and at the end.
  expect(placed(SOURCE, 0)?.before).toBe("");
  expect(placed(SOURCE, SOURCE.length)?.before).toBe("two three");
});

test("a selection is placed from where it began to where it ended", () => {
  const start = SOURCE.indexOf("one");
  const end = SOURCE.indexOf("three") + 5;
  const selected = placed(SOURCE, start, end)?.selected ?? "";
  expect(selected.replace(/\s+/g, " ")).toContain("one");
  expect(selected).toContain("three");
  expect(selected).not.toContain("Hello");
});

test("an editor with no text takes no selection and does not fail", () => {
  expect(placed("", 0)).toBeUndefined();
});
