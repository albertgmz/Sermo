import { expect, test } from "bun:test";
import { $isLinkNode, LinkNode } from "@lexical/link";
import { $convertToMarkdownString, TRANSFORMERS } from "@lexical/markdown";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  createEditor,
  type LexicalNode,
} from "lexical";
import {
  $applyLink,
  $insertMention,
  $insertText,
  $removeAttachTags,
  $wrapSelection,
} from "./editor-commands";

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

// What the editor writes for what it holds, as the form sends it.
function markdownOf(editor: ReturnType<typeof createEditor>) {
  let out = "";
  editor.read(() => {
    out = $convertToMarkdownString(TRANSFORMERS);
  });
  return out;
}

const caretAt =
  (offset: number) => (node: ReturnType<typeof $createTextNode>) =>
    node.select(offset, offset);

test("an attachment tag goes in at the caret and the export keeps its brackets", () => {
  const editor = editorWith("before after", caretAt(7));
  run(editor, () => $insertText("[ATTACH=full]12[/ATTACH]"));
  expect(markdownOf(editor)).toBe("before [ATTACH=full]12[/ATTACH]after");
});

test("a tag replaces the selected text", () => {
  const editor = editorWith("one two three", (node) => node.select(4, 7));
  run(editor, () => $insertText("[ATTACH]3[/ATTACH]"));
  expect(markdownOf(editor)).toBe("one [ATTACH]3[/ATTACH] three");
});

test("an editor that never had the focus takes the tag at its end", () => {
  const editor = editorWith("text", () => {});
  run(editor, () => {
    $setSelection(null);
    $insertText("[ATTACH]5[/ATTACH]");
  });
  expect(markdownOf(editor)).toBe("text[ATTACH]5[/ATTACH]");
});

test("the spoiler wraps the selection", () => {
  const editor = editorWith("see the end", (node) => node.select(4, 7));
  run(editor, () => $wrapSelection("[SPOILER]", "[/SPOILER]"));
  expect(markdownOf(editor)).toBe("see [SPOILER]the[/SPOILER] end");
});

test("the spoiler on a backwards selection wraps the same text", () => {
  const editor = editorWith("see the end", (node) => {
    const selection = node.select(0, 0);
    selection.anchor.set(node.getKey(), 7, "text");
    selection.focus.set(node.getKey(), 4, "text");
  });
  run(editor, () => $wrapSelection("[SPOILER]", "[/SPOILER]"));
  expect(markdownOf(editor)).toBe("see [SPOILER]the[/SPOILER] end");
});

test("the spoiler with nothing selected leaves the caret between its tags", () => {
  const editor = editorWith("ab", caretAt(1));
  run(editor, () => {
    $wrapSelection("[SPOILER]", "[/SPOILER]");
    $insertText("x");
  });
  expect(markdownOf(editor)).toBe("a[SPOILER]x[/SPOILER]b");
});

test("a media tag and a spoiler with a title survive the export without escapes", () => {
  const editor = editorWith("", () => {});
  run(editor, () =>
    $insertText(
      "[MEDIA=youtube]dQw4w9WgXcQ[/MEDIA] [SPOILER=Title]hid[/SPOILER]",
    ),
  );
  expect(markdownOf(editor)).toBe(
    "[MEDIA=youtube]dQw4w9WgXcQ[/MEDIA] [SPOILER=Title]hid[/SPOILER]",
  );
});

test("removing an attachment takes its tags out of the editor, whichever the size", () => {
  const editor = editorWith(
    "a [ATTACH]4[/ATTACH] b [ATTACH=full]4[/ATTACH] c [ATTACH]5[/ATTACH]",
    () => {},
  );
  run(editor, () => $removeAttachTags(4));
  expect(markdownOf(editor)).toBe("a  b  c [ATTACH]5[/ATTACH]");
});
