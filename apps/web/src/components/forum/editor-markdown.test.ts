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
      out = unescapeMentions($convertToMarkdownString(TRANSFORMERS));
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
