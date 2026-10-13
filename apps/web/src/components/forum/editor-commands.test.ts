import { expect, test } from "bun:test";
import { $isLinkNode, LinkNode } from "@lexical/link";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  createEditor,
  type LexicalNode,
} from "lexical";
import { $applyLink, $insertMention } from "./editor-commands";

// An editor holding one paragraph, with the caret (or the range) set by `select`.
function editorWith(
  text: string,
  select: (node: ReturnType<typeof $createTextNode>) => void,
) {
  const editor = createEditor({
    nodes: [LinkNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      const node = $createTextNode(text);
      $getRoot().clear().append($createParagraphNode().append(node));
      select(node);
    },
    { discrete: true },
  );
  return editor;
}

function run(editor: ReturnType<typeof createEditor>, change: () => void) {
  editor.update(change, { discrete: true });
}

function snapshot(editor: ReturnType<typeof createEditor>) {
  return editor.getEditorState().read(() => {
    const parts: string[] = [];
    const walk = (node: LexicalNode) => {
      if ($isLinkNode(node)) {
        parts.push(`[${node.getTextContent()}](${node.getURL()})`);
      } else if ($isElementNode(node)) {
        for (const child of node.getChildren()) walk(child);
      } else {
        parts.push(node.getTextContent());
      }
    };
    walk($getRoot());
    return parts.join("");
  });
}

test("a mention at the end of the text is followed by one space", () => {
  const editor = editorWith("hello @wr", (node) => node.select(9, 9));
  run(editor, () => $insertMention("@wren"));
  expect(snapshot(editor)).toBe("hello @wren ");
});

test("a mention before a space already in the text adds none", () => {
  const editor = editorWith("hello @wr there", (node) => node.select(9, 9));
  run(editor, () => $insertMention("@wren"));
  expect(snapshot(editor)).toBe("hello @wren there");
});

test("a link with nothing selected is put in at the caret, not around the whole text", () => {
  const editor = editorWith("see here", (node) => node.select(4, 4));
  run(editor, () => $applyLink("https://example.test"));
  expect(snapshot(editor)).toBe(
    "see [https://example.test](https://example.test)here",
  );
});

test("the caret is left after the inserted link, so typing does not extend it", () => {
  const editor = editorWith("see here", (node) => node.select(4, 4));
  run(editor, () => {
    $applyLink("https://example.test");
    const selection = $getSelection();
    if ($isRangeSelection(selection)) selection.insertText("X");
  });
  expect(snapshot(editor)).toBe(
    "see [https://example.test](https://example.test)Xhere",
  );
});

test("a link on selected text wraps only that text", () => {
  const editor = editorWith("see here now", (node) => node.select(4, 8));
  run(editor, () => $applyLink("https://example.test"));
  expect(snapshot(editor)).toBe("see [here](https://example.test) now");
});
