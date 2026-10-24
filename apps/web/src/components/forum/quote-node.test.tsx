import { expect, test } from "bun:test";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { registerRichText } from "@lexical/rich-text";
import {
  $createNodeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isParagraphNode,
  $isRangeSelection,
  $isTextNode,
  $setSelection,
  CONTROLLED_TEXT_INSERTION_COMMAND,
  createEditor,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type LexicalEditor,
} from "lexical";
import { renderToStaticMarkup } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { withIntl } from "@/lib/test-intl";
import {
  $appendBb,
  $exportBb,
  $insertBb,
  $replaceWithBb,
  BB_NODES,
} from "./bb-lexical";
import { quoteOf } from "./bb-text";
import {
  $isQuoteBlockNode,
  QuoteBlockNode,
  registerQuoteBlocks,
} from "./quote-node";
import { QuoteBody, QuoteView, removeQuote } from "./quote-view";

function editorOf(source: string) {
  const editor = createEditor({
    nodes: BB_NODES,
    onError: (error) => {
      throw error;
    },
  });
  registerQuoteBlocks(editor);
  registerRichText(editor);
  editor.update(() => $replaceWithBb(source), { discrete: true });
  return editor;
}

const run = (editor: LexicalEditor, change: () => void) =>
  editor.update(change, { discrete: true });
const bbOf = (editor: LexicalEditor) => editor.read(() => $exportBb());
// The top-level blocks, as "quote" for the fixed block and the node type for the rest.
const shape = (editor: LexicalEditor) =>
  editor.read(() =>
    $getRoot()
      .getChildren()
      .map((node) =>
        node instanceof QuoteBlockNode ? "quote" : node.getType(),
      ),
  );
const quotes = (editor: LexicalEditor) =>
  editor.read(() =>
    $getRoot()
      .getChildren()
      .filter($isQuoteBlockNode)
      .map((node) => node.getRaw()),
  );

// Sources the editor writes back exactly as they are.
const SAME = [
  "[QUOTE]quoted\ntext[/QUOTE]\n\nMy answer.",
  '[QUOTE="wren, post: 12, member: 3"]quoted[/QUOTE]\n\nMy answer.',
  "[QUOTE='wren, post: 12, member: 3']single quotes[/QUOTE]",
  '[QUOTE="wren, convMessage: 4, member: 3"]from a conversation[/QUOTE]',
  // Spaces and blank lines inside the quote are kept as they are.
  "[QUOTE]  spaced  \n\n\n  and apart  [/QUOTE]",
  // Nested quotes stay inside the one they are in, tags and all.
  '[QUOTE="a, post: 1, member: 2"]outer [QUOTE="b, post: 3, member: 4"]inner[/QUOTE] more[/QUOTE]\n\nreply',
  "[QUOTE]one [QUOTE]two [QUOTE]three[/QUOTE][/QUOTE][/QUOTE]",
  // Formatting and tags the editor does not show stay as they were written.
  '[QUOTE="a, post: 1, member: 2"][B]bold[/B] [I]it[/I] [URL=https://a.test]link[/URL]\n[LIST]\n[*]x\n[/LIST][/QUOTE]',
  "[QUOTE][COLOR=red]red[/COLOR] [SPOILER]s[/SPOILER] [ATTACH]12[/ATTACH][/QUOTE]",
  "[QUOTE][CODE]\n[/QUOTE]\n[/CODE][/QUOTE]",
  "before\n\n[QUOTE]q[/QUOTE]\n\nafter",
  "[QUOTE]a[/QUOTE]\n\n[QUOTE]b[/QUOTE]",
  "[B]a[/B]\n\n[QUOTE]q[/QUOTE]\n\n[HEADING=1]h[/HEADING]",
];

test("BB code with quotes is written back as it was, whatever is in them", () => {
  for (const source of SAME) {
    expect({ source, out: bbOf(editorOf(source)) }).toEqual({
      source,
      out: source,
    });
  }
});

test("a quote is one fixed block, with its nested quotes inside it", () => {
  const source =
    'Intro\n\n[QUOTE="wren, post: 12, member: 3"]hi [QUOTE]inner[/QUOTE][/QUOTE]\n\nAnswer';
  const editor = editorOf(source);
  expect(shape(editor)).toEqual(["paragraph", "quote", "paragraph"]);
  expect(quotes(editor)).toEqual([
    '[QUOTE="wren, post: 12, member: 3"]hi [QUOTE]inner[/QUOTE][/QUOTE]',
  ]);
});

test("a quote with nothing in it stays text", () => {
  const editor = editorOf("[QUOTE] [/QUOTE]");
  expect(quotes(editor)).toEqual([]);
  expect(bbOf(editor)).toBe("[QUOTE] [/QUOTE]");
});

test("an empty paragraph is kept before a first quote, after a last one and between two", () => {
  expect(shape(editorOf("[QUOTE]q[/QUOTE]"))).toEqual([
    "paragraph",
    "quote",
    "paragraph",
  ]);
  expect(shape(editorOf("[QUOTE]a[/QUOTE]\n\n[QUOTE]b[/QUOTE]"))).toEqual([
    "paragraph",
    "quote",
    "paragraph",
    "quote",
    "paragraph",
  ]);
  // None of them is written.
  expect(bbOf(editorOf("[QUOTE]q[/QUOTE]"))).toBe("[QUOTE]q[/QUOTE]");
});

test("the paragraphs beside a quote come back when they are taken away", () => {
  const editor = editorOf("[QUOTE]q[/QUOTE]");
  run(editor, () => {
    const [first, , last] = $getRoot().getChildren();
    first.remove();
    last.remove();
  });
  expect(shape(editor)).toEqual(["paragraph", "quote", "paragraph"]);
});

test("a quoted post added below the text is a block, with the caret on a paragraph under it", () => {
  const editor = editorOf("my answer");
  run(editor, () =>
    $appendBb(`${quoteOf(7, "wren", 3, "[B]said[/B]\n\nmore")}\n\n`),
  );
  expect(shape(editor)).toEqual(["paragraph", "quote", "paragraph"]);
  expect(quotes(editor)).toEqual([
    '[QUOTE="wren, post: 7, member: 3"][B]said[/B]\n\nmore[/QUOTE]',
  ]);
  run(editor, () => {
    const selection = $getSelection();
    expect($isRangeSelection(selection)).toBe(true);
    if ($isRangeSelection(selection)) selection.insertText("mine");
  });
  expect(bbOf(editor)).toBe(
    'my answer\n\n[QUOTE="wren, post: 7, member: 3"][B]said[/B]\n\nmore[/QUOTE]\n\nmine',
  );
});

// Selects the first quote as a whole, as a click on it does.
function selectQuote(editor: LexicalEditor) {
  run(editor, () => {
    const quote = $getRoot().getChildren().find($isQuoteBlockNode);
    const selection = $createNodeSelection();
    if (quote) selection.add(quote.getKey());
    $setSelection(selection);
  });
}

test("typing with the quote selected changes nothing in it", () => {
  const source = '[QUOTE="wren, post: 12, member: 3"]quoted[/QUOTE]';
  const editor = editorOf(source);
  selectQuote(editor);
  expect(editor.read(() => $isNodeSelection($getSelection()))).toBe(true);
  editor.update(
    () => {
      editor.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, "x");
    },
    { discrete: true },
  );
  expect(bbOf(editor)).toBe(source);
  expect(quotes(editor)).toEqual([source]);
});

test("text typed in the paragraphs beside a quote does not enter it", () => {
  const source = "[QUOTE]quoted[/QUOTE]";
  const editor = editorOf(source);
  run(editor, () => {
    const [before, , after] = $getRoot().getChildren();
    if ($isParagraphNode(before)) before.append($createTextNode("above"));
    if ($isParagraphNode(after)) after.append($createTextNode("below"));
  });
  expect(bbOf(editor)).toBe("above\n\n[QUOTE]quoted[/QUOTE]\n\nbelow");
  expect(quotes(editor)).toEqual([source]);
});

test("the remove button takes the whole quote out and leaves the text around it", () => {
  const editor = editorOf("before\n\n[QUOTE]q[/QUOTE]\n\nafter");
  const key = editor.read(
    () => $getRoot().getChildren().find($isQuoteBlockNode)?.getKey() ?? "",
  );
  expect(quotes(editor)).toHaveLength(1);
  removeQuote(editor, key);
  expect(bbOf(editor)).toBe("before\n\nafter");
  expect(quotes(editor)).toEqual([]);
});

const KEYS = [
  ["Backspace", KEY_BACKSPACE_COMMAND],
  ["Delete", KEY_DELETE_COMMAND],
] as const;

for (const [name, command] of KEYS) {
  test(`${name} with the quote selected removes the whole quote`, () => {
    const editor = editorOf("before\n\n[QUOTE]q[/QUOTE]\n\nafter");
    selectQuote(editor);
    expect(editor.read(() => $isNodeSelection($getSelection()))).toBe(true);
    let prevented = false;
    editor.update(
      () => {
        editor.dispatchCommand(command, {
          preventDefault: () => {
            prevented = true;
          },
          target: null,
        } as unknown as KeyboardEvent);
      },
      { discrete: true },
    );
    expect(prevented).toBe(true);
    expect(bbOf(editor)).toBe("before\n\nafter");
  });
}

test("a quote shows its author, the post it names and its text as formatted text", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <QuoteBody raw='[QUOTE="Fulano, post: 12, member: 3"][B]hola[/B] [I]a todos[/I]\n\n[QUOTE]antes[/QUOTE][/QUOTE]' />,
    ),
  );
  expect(html).toContain('<cite class="bb-quote-author">');
  expect(html).toContain('href="/posts/12"');
  expect(html).toContain(">Fulano</a>");
  expect(html).toContain("<strong");
  expect(html).toContain("<em");
  // The nested quote is a quote of its own, without the name of anyone.
  expect(html.match(/<blockquote/g)?.length).toBe(2);
  expect(html.match(/<cite/g)?.length).toBe(1);
  expect(html).not.toContain("[QUOTE");
});

test("a quote of a conversation message links to the message", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <QuoteBody raw='[QUOTE="Fulano, convMessage: 8, member: 3"]hola[/QUOTE]' />,
    ),
  );
  expect(html).toContain('href="/conversations/messages/8"');
});

test("a quote without a name has no author line", () => {
  const html = renderToStaticMarkup(
    withIntl(<QuoteBody raw="[QUOTE]hola[/QUOTE]" />),
  );
  expect(html).not.toContain("<cite");
  expect(html).toContain("hola");
});

test("the block has a remove button with an accessible label", () => {
  const html = renderToStaticMarkup(
    withIntl(
      <LexicalComposer
        initialConfig={{
          namespace: "test",
          nodes: BB_NODES,
          onError: (error) => {
            throw error;
          },
        }}
      >
        <QuoteView nodeKey="1" raw="[QUOTE]hola[/QUOTE]" />
      </LexicalComposer>,
    ),
  );
  expect(html).toContain(`aria-label="${messages.editor.editor.quote.remove}"`);
});

test("a quote put in at the caret splits the paragraph around it", () => {
  const editor = editorOf("before after");
  run(editor, () => {
    const text = $getRoot().getFirstDescendant();
    if ($isTextNode(text)) text.select(7, 7);
    $insertBb('[QUOTE="wren, post: 7, member: 3"]said[/QUOTE]');
  });
  expect(quotes(editor)).toEqual([
    '[QUOTE="wren, post: 7, member: 3"]said[/QUOTE]',
  ]);
  expect(bbOf(editor)).toBe(
    'before\n\n[QUOTE="wren, post: 7, member: 3"]said[/QUOTE]\n\nafter',
  );
});
