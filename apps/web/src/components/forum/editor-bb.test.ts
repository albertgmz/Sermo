import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  registerList,
} from "@lexical/list";
import { registerRichText } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  createEditor,
  FORMAT_TEXT_COMMAND,
  type LexicalEditor,
  type TextFormatType,
} from "lexical";
import { renderBbCode } from "../../../../../packages/core/src/render";
import {
  $appendBb,
  $exportBb,
  $insertBb,
  $replaceWithBb,
  BB_NODES,
} from "./bb-lexical";
import { mentionOf, quoteOf } from "./bb-text";
import {
  $applyLink,
  $insertMention,
  $insertText,
  $setBlock,
  $wrapSelection,
} from "./editor-commands";
import { TYPING } from "./editor-extras";

// An editor holding one paragraph of `text`, with `from`..`to` selected, wired like the real one.
function editorWith(text: string, from = 0, to = text.length) {
  const editor = createEditor({
    nodes: BB_NODES,
    onError: (error) => {
      throw error;
    },
  });
  registerRichText(editor);
  registerList(editor);
  editor.update(
    () => {
      const node = $createTextNode(text);
      $getRoot().clear().append($createParagraphNode().append(node));
      node.select(from, to);
    },
    { discrete: true },
  );
  return editor;
}

const run = (editor: LexicalEditor, change: () => void) =>
  editor.update(change, { discrete: true });
const bbOf = (editor: LexicalEditor) => {
  let out = "";
  editor.read(() => {
    out = $exportBb();
  });
  return out;
};

for (const [format, tag] of [
  ["bold", "B"],
  ["italic", "I"],
  ["underline", "U"],
  ["strikethrough", "S"],
  ["code", "ICODE"],
] as [TextFormatType, string][]) {
  test(`the ${format} button writes [${tag}]`, () => {
    const editor = editorWith("make this loud", 5, 9);
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    expect(bbOf(editor)).toBe(`make [${tag}]this[/${tag}] loud`);
  });
}

test("formats that overlap are written as tags that nest", () => {
  const editor = editorWith("");
  run(editor, () => {
    const one = $createTextNode("one ").toggleFormat("bold");
    const two = $createTextNode("two")
      .toggleFormat("bold")
      .toggleFormat("italic");
    const three = $createTextNode(" three").toggleFormat("italic");
    $getRoot()
      .clear()
      .append($createParagraphNode().append(one, two, three));
  });
  expect(bbOf(editor)).toBe("[B]one [I]two[/I][/B][I] three[/I]");
});

test("the heading, quote and code block buttons write their tags, and write plain text back", () => {
  for (const [block, bb] of [
    ["heading", "[HEADING=2]make this[/HEADING]"],
    ["quote", "[QUOTE]make this[/QUOTE]"],
    ["code", "[CODE]\nmake this\n[/CODE]"],
  ] as const) {
    const editor = editorWith("make this");
    run(editor, () => $setBlock("paragraph", block));
    expect(bbOf(editor)).toBe(bb);
    run(editor, () => $setBlock(block, block));
    expect(bbOf(editor)).toBe("make this");
  }
});

test("the list buttons write a list", () => {
  const bullets = editorWith("one");
  bullets.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
  expect(bbOf(bullets)).toBe("[LIST]\n[*]one\n[/LIST]");
  const numbers = editorWith("one");
  numbers.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
  expect(bbOf(numbers)).toBe("[LIST=1]\n[*]one\n[/LIST]");
});

test("the link button writes a link around the selection, or the address as a link", () => {
  const selected = editorWith("see here now", 4, 8);
  run(selected, () => $applyLink("https://example.test/a?b=1"));
  expect(bbOf(selected)).toBe(
    "see [URL=https://example.test/a?b=1]here[/URL] now",
  );
  const bare = editorWith("see ", 4, 4);
  run(bare, () => $applyLink("https://example.test"));
  expect(bbOf(bare)).toBe("see [URL]https://example.test[/URL]");
  const unsafe = editorWith("see here", 4, 8);
  run(unsafe, () => $applyLink("javascript:alert(1)"));
  expect(bbOf(unsafe)).toBe("see here");
});

test("the spoiler and media buttons put their tags in the text", () => {
  const spoiler = editorWith("a secret here", 2, 8);
  run(spoiler, () => $wrapSelection("[SPOILER]", "[/SPOILER]"));
  expect(bbOf(spoiler)).toBe("a [SPOILER]secret[/SPOILER] here");
  const media = editorWith("watch ", 6, 6);
  run(media, () => $insertText("[MEDIA=youtube]kQ0Eo1UccEE[/MEDIA]"));
  expect(bbOf(media)).toBe("watch [MEDIA=youtube]kQ0Eo1UccEE[/MEDIA]");
});

test("a chosen member is a mention in the text", () => {
  const editor = editorWith("hello @wr", 9, 9);
  run(editor, () => $insertMention(mentionOf("wren", 4)));
  expect(bbOf(editor)).toBe("hello @wren");
  const spaced = editorWith("hello @tw", 9, 9);
  run(spaced, () => $insertMention(mentionOf("two words", 5)));
  expect(bbOf(spaced)).toBe('hello @"two words"');
  const imported = editorWith("hello @#bi", 10, 10);
  run(imported, () => $insertMention(mentionOf("#Bishop", 6)));
  expect(bbOf(imported)).toBe("hello [USER=6]#Bishop[/USER]");
  const quoted = editorWith('hello @"yo', 10, 10);
  run(quoted, () => $insertMention(mentionOf('"Yoandy_Isse"', 7)));
  expect(bbOf(quoted)).toBe('hello [USER=7]"Yoandy_Isse"[/USER]');
});

test("the mention menu opens after an @ that starts a word, also for a name that starts with a symbol", () => {
  const typed = (before: string) => TYPING.exec(before)?.[1] ?? null;
  expect(typed("hello @wr")).toBe("wr");
  expect(typed("hello @#bi")).toBe("#bi");
  expect(typed('see @"yo')).toBe('"yo');
  expect(typed("(@$kyw")).toBe("$kyw");
  expect(typed("@wren")).toBe("wren");
  // An address, or an "@" inside a word, is not a mention.
  expect(typed("write to ann@exa")).toBeNull();
  expect(typed("a@b")).toBeNull();
  expect(typed("hello @")).toBeNull();
  expect(typed("hello @wren is")).toBeNull();
});

test("a quoted post is added below the text, with the caret on a paragraph below it", () => {
  const editor = editorWith("my answer");
  const quote = quoteOf(7, "wren", 3, "[B]said[/B]\n\nmore");
  run(editor, () => $appendBb(`${quote}\n\n`));
  expect(bbOf(editor)).toBe(
    'my answer\n\n[QUOTE="wren, post: 7, member: 3"][B]said[/B]\n\nmore[/QUOTE]',
  );
  run(editor, () => {
    const selection = $getSelection();
    expect(
      $isRangeSelection(selection) &&
        selection.anchor.getNode().getTextContentSize(),
    ).toBe(0);
    if ($isRangeSelection(selection)) selection.insertText("mine");
  });
  expect(bbOf(editor).endsWith("more[/QUOTE]\n\nmine")).toBe(true);
});

test("the source is the rich text written out, and reading it back keeps the content", () => {
  const sources = [
    "[B]bold[/B] and [URL=https://a.test]a link[/URL]\n\n[LIST]\n[*]one\n[*]two\n[/LIST]",
    '[QUOTE="wren, post: 7, member: 3"]said[/QUOTE]\n\n[SPOILER]hidden[/SPOILER] @wren',
    "[HEADING=1]Title[/HEADING]\n\n[CODE=js]\nlet a = 1;\n[/CODE]\n\nlast",
  ];
  for (const source of sources) {
    const editor = createEditor({
      nodes: BB_NODES,
      onError: (e) => {
        throw e;
      },
    });
    run(editor, () => $replaceWithBb(source));
    const shown = bbOf(editor);
    expect(shown).toBe(source);
    run(editor, () => $replaceWithBb(shown));
    expect(bbOf(editor)).toBe(source);
  }
});

test("Markdown typed or pasted as text stays text", () => {
  const typed =
    "**bold** *it* `code` # head\n\n- item\n\n1. one\n\n> quote\n\n[a](https://a.test)";
  const editor = editorWith("");
  run(editor, () => {
    $getRoot().selectEnd();
    $insertBb(typed, true);
  });
  expect(bbOf(editor)).toBe(typed);
  editor.read(() => {
    for (const node of $getRoot().getAllTextNodes()) {
      expect($isTextNode(node) && node.getFormat()).toBe(0);
    }
    expect(
      $getRoot()
        .getChildren()
        .every((child) => child.getType() === "paragraph"),
    ).toBe(true);
  });
});

test("BB code pasted as plain text is taken as typed", () => {
  const editor = editorWith("");
  run(editor, () => {
    $getRoot().selectEnd();
    $insertBb("[B]x[/B]\n\ny", true);
  });
  expect(bbOf(editor)).toBe("[B]x[/B]\n\ny");
  editor.read(() => {
    expect(
      $getRoot()
        .getAllTextNodes()
        .every((node) => node.getFormat() === 0),
    ).toBe(true);
  });
});

test("the editor has no Markdown shortcuts and no Markdown import", () => {
  const source = readFileSync(join(import.meta.dir, "editor.tsx"), "utf8");
  expect(source).not.toMatch(/markdown/i);
  for (const file of [
    "bb-lexical.ts",
    "bb-parse.ts",
    "editor-extras.tsx",
    "html-to-bb.ts",
  ]) {
    expect(readFileSync(join(import.meta.dir, file), "utf8")).not.toMatch(
      /@lexical\/markdown/,
    );
  }
});

test("pasting into a code block puts in the text as it was copied, not formatting", () => {
  const editor = editorWith("let a;", 6, 6);
  run(editor, () => $setBlock("paragraph", "code"));
  run(editor, () =>
    $insertBb("[B]bold[/B]\n\n[LIST]\n[*]x\n[/LIST]", false, "bold\n\nx"),
  );
  expect(bbOf(editor)).toBe("[CODE]\nlet a;bold\n\nx\n[/CODE]");
});

test("what is pasted keeps the space at its edges", () => {
  const editor = editorWith("hello", 5, 5);
  run(editor, () => $insertBb(" world", true));
  expect(bbOf(editor)).toBe("hello world");
  const spaced = editorWith("ab", 1, 1);
  run(spaced, () => $insertBb(" ", true));
  expect(bbOf(spaced)).toBe("a b");
});

// Code that shows BB code, closing tags included, is drawn as that text by the renderer.
test("code that holds its own closing tag is written so that the page shows it as code text", () => {
  for (const text of [
    "[CODE]print(1)[/CODE]",
    "[B]x[/B]\n[/CODE] [I]y[/I]",
    "a [/PLAIN] b [/plain]",
  ]) {
    const editor = editorWith("");
    run(editor, () => {
      $getRoot()
        .clear()
        .append($createParagraphNode().append($createTextNode(text)));
      $getRoot().getFirstChild()?.selectStart();
      $setBlock("paragraph", "code");
    });
    const bb = bbOf(editor);
    const html = renderBbCode(bb);
    const shown = html
      .replace(/<br \/>/g, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
    expect(html, bb).toContain("<pre><code>");
    expect(html, bb).not.toContain("<strong>");
    expect(shown, bb).toBe(text);
    // And it comes back into the editor as the same code block.
    const again = editorWith("");
    run(again, () => $replaceWithBb(bb));
    expect(bbOf(again)).toBe(bb);
    again.read(() => {
      expect($getRoot().getFirstChild()?.getType()).toBe("code");
    });
  }
});

test("inline code that holds its closing tag is written so that the page shows it as code text", () => {
  const editor = editorWith("");
  run(editor, () => {
    const code = $createTextNode("a[/ICODE]b").toggleFormat("code");
    const bold = $createTextNode("bold ").toggleFormat("bold");
    $getRoot().clear().append($createParagraphNode().append(bold, code));
  });
  const bb = bbOf(editor);
  const html = renderBbCode(bb);
  expect(html, bb).toContain("<code>a[/ICODE]b</code>");
  expect(html, bb).toContain("<strong>bold </strong>");
  const again = editorWith("");
  run(again, () => $replaceWithBb(bb));
  expect(bbOf(again)).toBe(bb);
});
