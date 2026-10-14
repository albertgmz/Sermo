import { test } from "bun:test";
import assert from "node:assert/strict";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { createEditor } from "lexical";
import { unescapeBbCode } from "./bb-text";
import { unescapeMentions } from "./mention-text";

// What the editor writes back for a Markdown source it was given, as the edit form does.
function roundTrip(source: string) {
  const editor = createEditor({
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      LinkNode,
      AutoLinkNode,
      CodeNode,
      CodeHighlightNode,
    ],
  });
  let out = "";
  editor.update(
    () => {
      $convertFromMarkdownString(source, TRANSFORMERS);
      out = unescapeBbCode(
        unescapeMentions($convertToMarkdownString(TRANSFORMERS)),
      );
    },
    { discrete: true },
  );
  return out;
}

const SAME = [
  "Plain text.",
  "Some **bold** text and a [link](https://example.com/a?b=1).",
  "A mention of @wren and @some_user in a line.",
  'Hello @a_b_c and @"two words_x".',
  ':::quote{post=12 author="wren"}\n\nQuoted *text* here.\n\n:::\n\nMy answer.',
  ':::quote{post=12 author="wren"}\n\n:::quote{post=3}\n\ninner\n\n:::\n\nouter\n\n:::\n\nreply',
  "- one\n- two\n\n1. first\n2. second",
  "## Heading\n\nParagraph with `code`.",
  ">!hidden!< inline spoiler",
];

for (const source of SAME) {
  test(`the editor keeps ${JSON.stringify(source.slice(0, 32))}`, () => {
    assert.equal(roundTrip(source), source);
  });
}

// The BB code the toolbar and the attachment list put in is sent as typed. Code goes in a fence,
// which the editor writes back untouched; inside [CODE] it would escape `_` and `*`.
const BB = [
  "A [ATTACH]12[/ATTACH] thumbnail and [ATTACH=full]13[/ATTACH] full.",
  "[SPOILER]hidden[/SPOILER]",
  "[LIST=1][*]one[*]two[/LIST]",
  "[LIST]\n[*]one\n[*]two\n[/LIST]",
  "[SIZE=5]big[/SIZE] and [COLOR=#ff0000]red[/COLOR]",
  "[URL=https://a.com/x_y]a link[/URL]",
  "[URL]https://a.com/x_y*z[/URL]",
  "[IMG]https://a.com/a_b*c.png[/IMG]",
  '[QUOTE="a_b"]text[/QUOTE]',
  "[USER=3]some_user[/USER] and [FONT=Courier New]mono[/FONT]",
  "[MEDIA=youtube]dQw4w9WgXcQ[/MEDIA]",
  "```\nlet a_b = [1] * 2;\n```",
];

for (const source of BB) {
  test(`the editor keeps ${JSON.stringify(source.slice(0, 32))} as typed`, () => {
    assert.equal(roundTrip(source), source);
  });
}

// Square brackets that are not BB tags are still the editor's to write.
test("text in brackets that is not a tag keeps the editor's escapes", () => {
  assert.equal(roundTrip("a [b] c * d _e_ f"), String.raw`a [b] c \* d *e* f`);
  const link = String.raw`[link\_a](https://x.y)`;
  assert.equal(unescapeBbCode(link), link);
  assert.equal(
    unescapeBbCode(String.raw`[URL=https://a/b\_c]x\_y[/URL]`),
    String.raw`[URL=https://a/b_c]x\_y[/URL]`,
  );
});

test("code keeps the escapes the editor wrote, around BB tags that are restored", () => {
  const b = String.raw`\[B\]`;
  const u = String.raw`a\_b`;
  const fence = "```";
  const written = [
    `Type \`${b}\` then ${b}bold[/B]`,
    fence,
    `${b} ${u}`,
    fence,
    `${b}x[/B]`,
  ].join("\n");
  const expected = [
    `Type \`${b}\` then [B]bold[/B]`,
    fence,
    `${b} ${u}`,
    fence,
    "[B]x[/B]",
  ].join("\n");
  assert.equal(unescapeBbCode(written), expected);
});

test("a longer closing fence ends the block and an escaped backtick opens no span", () => {
  const b = String.raw`\[B\]`;
  const tick = "`";
  const block = ["```", b, "````", b].join("\n");
  assert.equal(unescapeBbCode(block), ["```", b, "````", "[B]"].join("\n"));
  const slash = String.raw`\ `.trim();
  const escaped = `a ${slash}${tick} ${b} and ${slash}${tick} b`;
  assert.equal(
    unescapeBbCode(escaped),
    `a ${slash}${tick} [B] and ${slash}${tick} b`,
  );
});
