import { expect, test } from "bun:test";
import {
  $createCodeNode,
  $isCodeNode,
  CodeHighlightNode,
  CodeNode,
} from "@lexical/code";
import { $createLinkNode, $isLinkNode, LinkNode } from "@lexical/link";
import {
  $createListItemNode,
  $createListNode,
  $isListNode,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import {
  $createHeadingNode,
  $createQuoteNode,
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  $setSelection,
  createEditor,
  type EditorState,
  type ElementNode,
  KEY_DOWN_COMMAND,
  type LexicalNode,
  type TextFormatType,
  type TextNode,
} from "lexical";
import { $exportBb } from "./bb-lexical";
import {
  $applyLink,
  $insertMention,
  $insertText,
  $removeAttachTags,
  $removeFormatting,
  $wrapSelection,
  registerRemoveFormattingShortcut,
} from "./editor-commands";

// An editor holding one paragraph, with the caret (or the range) set by `select`.
function editorWith(
  text: string,
  select: (node: ReturnType<typeof $createTextNode>) => void,
) {
  const editor = createEditor({
    nodes: [LinkNode, CodeNode],
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
function bbOf(editor: ReturnType<typeof createEditor>) {
  let out = "";
  editor.read(() => {
    out = $exportBb();
  });
  return out;
}

const caretAt =
  (offset: number) => (node: ReturnType<typeof $createTextNode>) =>
    node.select(offset, offset);

test("an attachment tag goes in at the caret and the export keeps its brackets", () => {
  const editor = editorWith("before after", caretAt(7));
  run(editor, () => $insertText("[ATTACH=full]12[/ATTACH]"));
  expect(bbOf(editor)).toBe("before [ATTACH=full]12[/ATTACH]after");
});

test("a tag replaces the selected text", () => {
  const editor = editorWith("one two three", (node) => node.select(4, 7));
  run(editor, () => $insertText("[ATTACH]3[/ATTACH]"));
  expect(bbOf(editor)).toBe("one [ATTACH]3[/ATTACH] three");
});

test("an editor that never had the focus takes the tag at its end", () => {
  const editor = editorWith("text", () => {});
  run(editor, () => {
    $setSelection(null);
    $insertText("[ATTACH]5[/ATTACH]");
  });
  expect(bbOf(editor)).toBe("text[ATTACH]5[/ATTACH]");
});

test("the spoiler wraps the selection", () => {
  const editor = editorWith("see the end", (node) => node.select(4, 7));
  run(editor, () => $wrapSelection("[SPOILER]", "[/SPOILER]"));
  expect(bbOf(editor)).toBe("see [SPOILER]the[/SPOILER] end");
});

test("the spoiler on a backwards selection wraps the same text", () => {
  const editor = editorWith("see the end", (node) => {
    const selection = node.select(0, 0);
    selection.anchor.set(node.getKey(), 7, "text");
    selection.focus.set(node.getKey(), 4, "text");
  });
  run(editor, () => $wrapSelection("[SPOILER]", "[/SPOILER]"));
  expect(bbOf(editor)).toBe("see [SPOILER]the[/SPOILER] end");
});

test("the spoiler with nothing selected leaves the caret between its tags", () => {
  const editor = editorWith("ab", caretAt(1));
  run(editor, () => {
    $wrapSelection("[SPOILER]", "[/SPOILER]");
    $insertText("x");
  });
  expect(bbOf(editor)).toBe("a[SPOILER]x[/SPOILER]b");
});

test("a media tag and a spoiler with a title survive the export without escapes", () => {
  const editor = editorWith("", () => {});
  run(editor, () =>
    $insertText(
      "[MEDIA=youtube]dQw4w9WgXcQ[/MEDIA] [SPOILER=Title]hid[/SPOILER]",
    ),
  );
  expect(bbOf(editor)).toBe(
    "[MEDIA=youtube]dQw4w9WgXcQ[/MEDIA] [SPOILER=Title]hid[/SPOILER]",
  );
});

test("removing an attachment takes its tags out of the editor, whichever the size", () => {
  const editor = editorWith(
    "a [ATTACH]4[/ATTACH] b [ATTACH=full]4[/ATTACH] c [ATTACH]5[/ATTACH]",
    () => {},
  );
  run(editor, () => $removeAttachTags(4));
  expect(bbOf(editor)).toBe("a  b  c [ATTACH]5[/ATTACH]");
});

test("removing an attachment leaves its tags in code as written", () => {
  const editor = createEditor({
    nodes: [CodeNode],
    onError: (error) => {
      throw error;
    },
  });
  run(editor, () => {
    const code = $createCodeNode();
    code.append($createTextNode("[ATTACH]4[/ATTACH]"));
    const inline = $createTextNode("[ATTACH]4[/ATTACH]").toggleFormat("code");
    $getRoot()
      .clear()
      .append(
        code,
        $createParagraphNode().append(
          inline,
          $createTextNode(" [ATTACH]4[/ATTACH]"),
        ),
      );
    $removeAttachTags(4);
  });
  let kept = "";
  editor.read(() => {
    kept = $getRoot().getTextContent();
  });
  expect(kept).toBe("[ATTACH]4[/ATTACH]\n\n[ATTACH]4[/ATTACH] ");
});

// An editor with every node the real one has, filled by `build`, with the selection it sets.
function richEditor(build: () => void) {
  const editor = createEditor({
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      LinkNode,
      CodeNode,
      CodeHighlightNode,
    ],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      $getRoot().clear();
      build();
    },
    { discrete: true },
  );
  return editor;
}

const formatted = (text: string, ...formats: TextFormatType[]) => {
  const node = $createTextNode(text);
  for (const format of formats) node.toggleFormat(format);
  return node;
};

test("remove formatting on a selection cleans only the selected text", () => {
  const editor = richEditor(() => {
    const node = formatted("bold and italic", "bold", "italic");
    $getRoot().append($createParagraphNode().append(node));
    node.select(5, 8);
  });
  run(editor, () => $removeFormatting());
  expect(bbOf(editor)).toBe("[B][I]bold [/I][/B]and[B][I] italic[/I][/B]");
});

test("remove formatting takes every inline format and any style off", () => {
  const editor = richEditor(() => {
    const node = formatted(
      "all",
      "bold",
      "italic",
      "underline",
      "strikethrough",
      "code",
      "subscript",
    ).setStyle("color: red; font-size: 20px; font-family: serif");
    $getRoot().append($createParagraphNode().append(node));
    node.select(0, 3);
  });
  run(editor, () => $removeFormatting());
  editor.read(() => {
    const node = $getRoot().getAllTextNodes()[0];
    expect(node?.getFormat()).toBe(0);
    expect(node?.getStyle()).toBe("");
  });
  expect(bbOf(editor)).toBe("all");
});

test("with nothing selected the whole message is cleaned", () => {
  const editor = richEditor(() => {
    $getRoot().append(
      $createParagraphNode().append(formatted("one", "bold")),
      $createParagraphNode().append(formatted("two", "italic")),
    );
    $getRoot().selectEnd();
  });
  run(editor, () => $removeFormatting());
  expect(bbOf(editor)).toBe("one\n\ntwo");
});

test("headings, quotes, lists and alignment become plain paragraphs", () => {
  const editor = richEditor(() => {
    const list = $createListNode("bullet").append(
      $createListItemNode().append($createTextNode("item a")),
      $createListItemNode().append($createTextNode("item b")),
    );
    $getRoot().append(
      $createHeadingNode("h2").append($createTextNode("title")),
      $createQuoteNode().append($createTextNode("said")),
      list,
      $createParagraphNode()
        .setFormat("center")
        .setIndent(1)
        .append($createTextNode("centred")),
    );
  });
  run(editor, () => $removeFormatting());
  expect(bbOf(editor)).toBe("title\n\nsaid\n\nitem a\n\nitem b\n\ncentred");
  editor.read(() => {
    for (const block of $getRoot().getChildren()) {
      expect($isParagraphNode(block)).toBe(true);
      if ($isElementNode(block)) {
        expect(block.getFormatType()).toBe("");
        expect(block.getIndent()).toBe(0);
      }
    }
  });
});

test("a selection cleans only the blocks it touches", () => {
  const editor = richEditor(() => {
    const first = $createTextNode("first");
    $getRoot().append(
      $createHeadingNode("h2").append(first),
      $createQuoteNode().append($createTextNode("second")),
    );
    first.select(1, 2);
  });
  run(editor, () => $removeFormatting());
  expect(bbOf(editor)).toBe("first\n\n[QUOTE]second[/QUOTE]");
});

test("BB code tags typed as text are stripped to their inner text", () => {
  const editor = richEditor(() => {
    $getRoot().append(
      $createParagraphNode().append(
        $createTextNode(
          "[b]one[/b] [COLOR=red]two [i]three[/i][/COLOR] [SIZE=5]four[/SIZE]",
        ),
      ),
    );
  });
  run(editor, () => $removeFormatting());
  expect(bbOf(editor)).toBe("one two three four");
});

test("a tag split across runs of different format is stripped too", () => {
  const editor = richEditor(() => {
    $getRoot().append(
      $createParagraphNode().append(
        $createTextNode("[b]so"),
        formatted("me", "bold"),
        $createTextNode("[/b]"),
      ),
    );
  });
  run(editor, () => $removeFormatting());
  expect(bbOf(editor)).toBe("some");
});

test("tags on a selection are stripped only inside it", () => {
  const editor = richEditor(() => {
    const node = $createTextNode("[b]in[/b] [b]out[/b]");
    $getRoot().append($createParagraphNode().append(node));
    node.select(0, 9);
  });
  run(editor, () => $removeFormatting());
  editor.read(() => {
    expect($getRoot().getTextContent()).toBe("in [b]out[/b]");
  });
});

test("links, mentions, attachments, spoilers and code blocks stay", () => {
  const editor = richEditor(() => {
    const link = $createLinkNode("https://example.test");
    link.append(formatted("a link", "bold"));
    const code = $createCodeNode();
    code.append($createTextNode("const x = 1;"));
    $getRoot().append(
      $createParagraphNode().append(
        link,
        $createTextNode(
          " @wren [ATTACH]3[/ATTACH] [SPOILER]hidden[/SPOILER] [MEDIA=youtube]abc[/MEDIA]",
        ),
      ),
      code,
    );
  });
  run(editor, () => $removeFormatting());
  editor.read(() => {
    expect($getRoot().getTextContent()).toBe(
      "a link @wren [ATTACH]3[/ATTACH] [SPOILER]hidden[/SPOILER] [MEDIA=youtube]abc[/MEDIA]\n\nconst x = 1;",
    );
    const link = $getRoot().getAllTextNodes()[0];
    expect(link?.getFormat()).toBe(0);
    expect($isLinkNode(link?.getParent())).toBe(true);
    expect($isCodeNode($getRoot().getLastChild())).toBe(true);
  });
});

test("tags in inline code are shown as written", () => {
  const editor = richEditor(() => {
    $getRoot().append(
      $createParagraphNode().append(formatted("[b]x[/b]", "code")),
    );
  });
  run(editor, () => $removeFormatting());
  editor.read(() => {
    expect($getRoot().getTextContent()).toBe("[b]x[/b]");
    expect($getRoot().getAllTextNodes()[0]?.getFormat()).toBe(0);
  });
});

test("the clean is one update, and the state before it holds everything", () => {
  const editor = richEditor(() => {
    $getRoot().append(
      $createHeadingNode("h2").append(formatted("[b]x[/b] bold", "bold")),
      $createQuoteNode().append(formatted("q", "italic")),
    );
  });
  const before = bbOf(editor);
  const previous: EditorState[] = [];
  editor.registerUpdateListener(({ prevEditorState }) =>
    previous.push(prevEditorState),
  );
  run(editor, () => $removeFormatting());
  // The history plugin records the state before each update, so a clean that is one update is one
  // Undo step. This checks that the clean is one update and that the state before it is whole; the
  // plugin itself is not driven here (@lexical/history is not a dependency of this app).
  expect(previous).toHaveLength(1);
  expect(bbOf(editor)).not.toBe(before);
  editor.setEditorState(previous[0] as EditorState);
  expect(bbOf(editor)).toBe(before);
});

// The top-level blocks as "type:text", with the items of a list joined by "|".
function outline(editor: ReturnType<typeof createEditor>) {
  return editor.read(() =>
    $getRoot()
      .getChildren()
      .map((block) =>
        $isListNode(block)
          ? `${block.getType()}:${block
              .getChildren()
              .map((item) => item.getTextContent())
              .join("|")}`
          : `${block.getType()}:${block.getTextContent()}`,
      ),
  );
}

test("a selection takes only the touched list items out of the list", () => {
  const editor = richEditor(() => {
    const b = $createTextNode("b");
    $getRoot().append(
      $createListNode("bullet").append(
        $createListItemNode().append($createTextNode("a")),
        $createListItemNode().append(b),
        $createListItemNode().append($createTextNode("c")),
      ),
    );
    b.select(0, 1);
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual(["list:a", "paragraph:b", "list:c"]);
});

test("a selection over the first items leaves the rest in the list", () => {
  const editor = richEditor(() => {
    const a = $createTextNode("a");
    const b = $createTextNode("b");
    $getRoot().append(
      $createListNode("number").append(
        $createListItemNode().append(a),
        $createListItemNode().append(b),
        $createListItemNode().append($createTextNode("c")),
      ),
    );
    a.select(0, 0).focus.set(b.getKey(), 1, "text");
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual(["paragraph:a", "paragraph:b", "list:c"]);
});

test("a selected nested list item leaves the list and the others stay", () => {
  let inner: TextNode | undefined;
  const editor = richEditor(() => {
    inner = $createTextNode("child");
    $getRoot().append(
      $createListNode("bullet").append(
        $createListItemNode().append($createTextNode("top")),
        $createListItemNode().append(
          $createListNode("bullet").append(
            $createListItemNode().append(inner),
            $createListItemNode().append($createTextNode("sibling")),
          ),
        ),
      ),
    );
    inner.select(0, 5);
  });
  run(editor, () => $removeFormatting());
  editor.read(() => {
    const kinds = $getRoot()
      .getChildren()
      .map((block) => block.getType());
    expect(kinds).toEqual(["list", "paragraph", "list"]);
    const text = $getRoot()
      .getChildren()
      .map((b) => b.getTextContent());
    expect(text).toEqual(["top", "child", "sibling"]);
  });
});

test("with nothing selected every list item becomes a paragraph", () => {
  const editor = richEditor(() => {
    $getRoot().append(
      $createListNode("bullet").append(
        $createListItemNode().append($createTextNode("a")),
        $createListItemNode().append($createTextNode("b")),
      ),
    );
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual(["paragraph:a", "paragraph:b"]);
});

function quoteOf(...lines: (string | TextNode)[]) {
  const quote = $createQuoteNode();
  lines.forEach((line, index) => {
    if (index) quote.append($createLineBreakNode());
    quote.append(typeof line === "string" ? $createTextNode(line) : line);
  });
  return quote;
}

test("a selection takes only the touched lines out of a quote", () => {
  const editor = richEditor(() => {
    const two = $createTextNode("two");
    $getRoot().append(quoteOf("one", two, "three"));
    two.select(0, 3);
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual([
    "quote:one",
    "paragraph:two",
    "quote:three",
  ]);
});

test("with nothing selected a quote becomes one paragraph with its lines", () => {
  const editor = richEditor(() => {
    $getRoot().append(quoteOf("one", "two"));
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual(["paragraph:one\ntwo"]);
});

test("a typed QUOTE tag is stripped, and one with an attribution stays: it names the post it quotes", () => {
  const editor = richEditor(() => {
    $getRoot().append(
      $createParagraphNode().append(
        $createTextNode(
          '[QUOTE]hi[/QUOTE] [QUOTE="wren, post: 1"]there[/QUOTE]',
        ),
      ),
    );
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual([
    'paragraph:hi [QUOTE="wren, post: 1"]there[/QUOTE]',
  ]);
});

test("typed LIST tags are stripped and their items become separate lines", () => {
  const editor = richEditor(() => {
    $getRoot().append(
      $createParagraphNode().append(
        $createTextNode("[LIST][*]one[*][b]two[/b][/LIST] after"),
      ),
      $createParagraphNode().append($createTextNode("[LIST=1][*]x[*]y[/LIST]")),
    );
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual([
    "paragraph:one\ntwo after",
    "paragraph:x\ny",
  ]);
  editor.read(() => {
    const kinds = ($getRoot().getFirstChild() as ElementNode)
      .getChildren()
      .map((node) => node.getType());
    expect(kinds).toEqual(["text", "linebreak", "text"]);
  });
});

test("IMG, EMAIL, URL, USER, PLAIN and TABLE tags stay as typed", () => {
  const text =
    "[IMG]https://a.test/x.png[/IMG] [EMAIL]a@b.test[/EMAIL] [URL=https://a.test]a[/URL] [USER=3]w[/USER] [PLAIN]p[/PLAIN] [TABLE][TR][TD]c[/TD][/TR][/TABLE]";
  const editor = richEditor(() => {
    $getRoot().append($createParagraphNode().append($createTextNode(text)));
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual([`paragraph:${text}`]);
});

// A key event as the editor receives it, without a DOM.
function keyEvent(init: Partial<KeyboardEvent>) {
  let prevented = 0;
  const event = {
    key: "\\",
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    preventDefault: () => prevented++,
    ...init,
  } as KeyboardEvent;
  return { event, prevented: () => prevented };
}

function shortcutEditor() {
  const editor = richEditor(() => {
    $getRoot().append($createParagraphNode().append(formatted("text", "bold")));
  });
  registerRemoveFormattingShortcut(editor);
  const updates: number[] = [];
  editor.registerUpdateListener(() => updates.push(1));
  return { editor, updates };
}

test("Ctrl+\\ cleans once and stops the key", () => {
  const { editor, updates } = shortcutEditor();
  const { event, prevented } = keyEvent({});
  editor.dispatchCommand(KEY_DOWN_COMMAND, event);
  editor.read(() => {
    expect($getRoot().getAllTextNodes()[0]?.getFormat()).toBe(0);
  });
  expect(prevented()).toBe(1);
  expect(updates).toHaveLength(1);
});

test("other keys, Shift or Alt with the backslash, and no Ctrl do nothing", () => {
  const { editor, updates } = shortcutEditor();
  for (const init of [
    { key: "q" },
    { shiftKey: true },
    { altKey: true },
    { ctrlKey: false },
  ]) {
    const { event, prevented } = keyEvent(init);
    editor.dispatchCommand(KEY_DOWN_COMMAND, event);
    expect(prevented()).toBe(0);
  }
  editor.read(() => {
    expect($getRoot().getAllTextNodes()[0]?.getFormat()).toBe(1);
  });
  expect(updates).toHaveLength(0);
});

// A selection from `from` to `to`, each a text node and an offset.
function selectBetween(
  from: [TextNode, number],
  to: [TextNode, number],
  backward = false,
) {
  const [head, tail] = backward ? [to, from] : [from, to];
  const selection = head[0].select(head[1], head[1]);
  selection.focus.set(tail[0].getKey(), tail[1], "text");
}

test("a selection that ends at the start of the next heading leaves it alone", () => {
  const editor = richEditor(() => {
    const a = $createTextNode("A");
    const b = $createTextNode("B");
    $getRoot().append(
      $createHeadingNode("h1").append(a),
      $createHeadingNode("h2").append(b),
    );
    selectBetween([a, 0], [b, 0]);
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual(["paragraph:A", "heading:B"]);
});

test("the same, selected backwards from the start of the next heading", () => {
  const editor = richEditor(() => {
    const a = $createTextNode("A");
    const b = $createTextNode("B");
    $getRoot().append(
      $createHeadingNode("h1").append(a),
      $createHeadingNode("h2").append(b),
    );
    selectBetween([a, 0], [b, 0], true);
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual(["paragraph:A", "heading:B"]);
});

test("a selection that starts at the end of a heading leaves it alone", () => {
  const editor = richEditor(() => {
    const a = $createTextNode("A");
    const b = $createTextNode("BB");
    $getRoot().append(
      $createHeadingNode("h1").append(a),
      $createHeadingNode("h2").append(b),
    );
    selectBetween([a, 1], [b, 2]);
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual(["heading:A", "paragraph:BB"]);
});

test("a selection that ends at the start of the next list item leaves it in the list", () => {
  const editor = richEditor(() => {
    const a = $createTextNode("a");
    const b = $createTextNode("b");
    $getRoot().append(
      $createListNode("bullet").append(
        $createListItemNode().append(a),
        $createListItemNode().append(b),
        $createListItemNode().append($createTextNode("c")),
      ),
    );
    selectBetween([a, 0], [b, 0]);
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual(["paragraph:a", "list:b|c"]);
});

test("a selection that ends at the start of the next quote leaves it a quote", () => {
  const editor = richEditor(() => {
    const a = $createTextNode("a");
    const b = $createTextNode("b");
    $getRoot().append($createHeadingNode("h2").append(a), quoteOf(b, "more"));
    selectBetween([a, 0], [b, 0]);
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual(["paragraph:a", "quote:b\nmore"]);
});

test("the text of the block the selection only reaches keeps its format", () => {
  const editor = richEditor(() => {
    const a = formatted("A", "bold");
    const b = formatted("B", "bold");
    $getRoot().append(
      $createParagraphNode().append(a),
      $createParagraphNode().append(b),
    );
    selectBetween([a, 0], [b, 0]);
  });
  run(editor, () => $removeFormatting());
  editor.read(() => {
    const [a, b] = $getRoot().getAllTextNodes();
    expect(a?.getFormat()).toBe(0);
    expect(b?.getFormat()).not.toBe(0);
  });
});

test("a selection that really enters the next block cleans it too", () => {
  const editor = richEditor(() => {
    const a = $createTextNode("A");
    const b = $createTextNode("BB");
    $getRoot().append(
      $createHeadingNode("h1").append(a),
      $createHeadingNode("h2").append(b),
    );
    selectBetween([a, 0], [b, 1]);
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual(["paragraph:A", "paragraph:BB"]);
});

function numbered(start: number, ...items: string[]) {
  const list = $createListNode("number", start);
  const texts = items.map((item) => $createTextNode(item));
  list.append(...texts.map((text) => $createListItemNode().append(text)));
  return { list, texts };
}

test("after a split the tail of a numbered list is a list of its own", () => {
  const editor = richEditor(() => {
    const { list, texts } = numbered(1, "a", "b", "c", "d");
    $getRoot().append(list);
    texts[1]?.select(0, 1);
  });
  run(editor, () => $removeFormatting());
  expect(bbOf(editor)).toBe(
    "[LIST=1]\n[*]a\n[/LIST]\n\nb\n\n[LIST=1]\n[*]c\n[*]d\n[/LIST]",
  );
});

test("both parts of a numbered list that starts at 5 start at 1, as BB code numbers from 1", () => {
  const editor = richEditor(() => {
    const { list, texts } = numbered(5, "a", "b", "c");
    $getRoot().append(list);
    texts[1]?.select(0, 1);
  });
  run(editor, () => $removeFormatting());
  expect(bbOf(editor)).toBe(
    "[LIST=1]\n[*]a\n[/LIST]\n\nb\n\n[LIST=1]\n[*]c\n[/LIST]",
  );
});

test("taking the first item out of a numbered list leaves the rest a list from 1", () => {
  const editor = richEditor(() => {
    const { list, texts } = numbered(5, "a", "b", "c");
    $getRoot().append(list);
    texts[0]?.select(0, 1);
  });
  run(editor, () => $removeFormatting());
  expect(bbOf(editor)).toBe("a\n\n[LIST=1]\n[*]b\n[*]c\n[/LIST]");
});

test("an empty quote becomes a paragraph, with nothing selected and inside a selection", () => {
  const editor = richEditor(() => {
    $getRoot().append($createQuoteNode());
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual(["paragraph:"]);

  const inside = richEditor(() => {
    const x = $createTextNode("x");
    const y = $createTextNode("y");
    $getRoot().append(
      $createParagraphNode().append(x),
      $createQuoteNode(),
      $createParagraphNode().append(y),
    );
    selectBetween([x, 0], [y, 1]);
  });
  run(inside, () => $removeFormatting());
  expect(outline(inside)).toEqual(["paragraph:x", "paragraph:", "paragraph:y"]);
});

test("the quote halves left behind keep the quote's alignment and indent", () => {
  const editor = richEditor(() => {
    const two = $createTextNode("two");
    const quote = quoteOf("one", two, "three").setFormat("center").setIndent(1);
    $getRoot().append(quote);
    two.select(0, 3);
  });
  run(editor, () => $removeFormatting());
  editor.read(() => {
    const [before, middle, after] = $getRoot().getChildren() as ElementNode[];
    expect(before?.getType()).toBe("quote");
    expect(before?.getFormatType()).toBe("center");
    expect(before?.getIndent()).toBe(1);
    expect(middle?.getType()).toBe("paragraph");
    expect(middle?.getFormatType()).toBe("");
    expect(after?.getFormatType()).toBe("center");
    expect(after?.getIndent()).toBe(1);
  });
});

test("a nested list left without its parent item does not export indented", () => {
  const editor = richEditor(() => {
    const top = $createTextNode("top");
    const kid = $createTextNode("kid");
    $getRoot().append(
      $createListNode("bullet").append(
        $createListItemNode().append(top),
        $createListItemNode().append(
          $createListNode("bullet").append(
            $createListItemNode().append(kid),
            $createListItemNode().append($createTextNode("kid2")),
          ),
        ),
      ),
    );
    selectBetween([top, 0], [kid, 3]);
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual([
    "paragraph:top",
    "paragraph:kid",
    "list:kid2",
  ]);
  expect(bbOf(editor)).toBe("top\n\nkid\n\n[LIST]\n[*]kid2\n[/LIST]");
});

test("an empty list item in the selection becomes a paragraph too", () => {
  const editor = richEditor(() => {
    const a = $createTextNode("a");
    const c = $createTextNode("c");
    $getRoot().append(
      $createListNode("bullet").append(
        $createListItemNode().append(a),
        $createListItemNode(),
        $createListItemNode().append(c),
        $createListItemNode().append($createTextNode("d")),
      ),
    );
    selectBetween([a, 0], [c, 1]);
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual([
    "paragraph:a",
    "paragraph:",
    "paragraph:c",
    "list:d",
  ]);
});

test("a selection over a list, a paragraph and a quote cleans exactly what it touches", () => {
  const editor = richEditor(() => {
    const b = $createTextNode("b");
    const lineTwo = $createTextNode("two");
    $getRoot().append(
      $createListNode("bullet").append(
        $createListItemNode().append($createTextNode("a")),
        $createListItemNode().append(b),
      ),
      $createParagraphNode().setFormat("center").append($createTextNode("p")),
      quoteOf("one", lineTwo, "three"),
    );
    selectBetween([b, 0], [lineTwo, 2]);
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual([
    "list:a",
    "paragraph:b",
    "paragraph:p",
    "paragraph:one\ntwo",
    "quote:three",
  ]);
});

test("an element-type point at the start of the next heading counts as its start", () => {
  const editor = richEditor(() => {
    const a = $createTextNode("A");
    const second = $createHeadingNode("h2").append($createTextNode("B"));
    $getRoot().append($createHeadingNode("h1").append(a), second);
    a.select(0, 0).focus.set(second.getKey(), 0, "element");
  });
  run(editor, () => $removeFormatting());
  expect(outline(editor)).toEqual(["paragraph:A", "heading:B"]);
});
