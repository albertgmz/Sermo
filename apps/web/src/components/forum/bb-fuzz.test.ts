import { expect, test } from "bun:test";
import { createEditor } from "lexical";
import { renderBbCode } from "../../../../../packages/core/src/render";
import { $exportBb, $replaceWithBb, BB_NODES } from "./bb-lexical";

// Texts made of random tags, options, breaks and words, read by the editor and written back.
const TOKENS = [
  "[B]",
  "[/B]",
  "[i]",
  "[/I]",
  "[U]",
  "[/U]",
  "[S]",
  "[/S]",
  "[URL=https://a.test]",
  '[URL="https://a.test/x"]',
  "[/URL]",
  "[URL]https://b.test[/URL]",
  "[URL]www.c.test[/URL]",
  "[HEADING=2]",
  "[/HEADING]",
  "[QUOTE]",
  "[/QUOTE]",
  '[QUOTE="a, post: 1, member: 2"]',
  "[LIST]",
  "[LIST=1]",
  "[/LIST]",
  "[*]",
  "[CODE]",
  "[CODE=ts]",
  "[/CODE]",
  "[CODE=rich]",
  "[ICODE]",
  "[/ICODE]",
  "[SPOILER]",
  "[/SPOILER]",
  "[COLOR=red]",
  "[/COLOR]",
  "[SIZE=5]",
  "[/SIZE]",
  "[PLAIN]",
  "[/PLAIN]",
  "[CODE=rich][PLAIN][/PLAIN][/CODE]",
  "[CODE=rich][PLAIN]word[/PLAIN][/CODE]",
  "[ICODE=rich][PLAIN] [/PLAIN][/ICODE]",
  "[CODE=rich][PLAIN]a[/[/PLAIN][PLAIN]PLAIN]b[/CODE][/PLAIN][/CODE]",
  "[PLAIN][/PLAIN]",
  "[IMG]https://x.test/a.png[/IMG]",
  "[IMG]",
  "[/IMG]",
  "[MEDIA=youtube]kQ0Eo1UccEE[/MEDIA]",
  "[ATTACH]12[/ATTACH]",
  "word",
  "other",
  "text",
  " ",
  " ",
  "\n",
  "\n",
  "\n\n",
  "İ",
  "[",
  "]",
];

// A generator that does not repeat within the run.
function mulberry(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const editor = createEditor({
  nodes: BB_NODES,
  onError: (e) => {
    throw e;
  },
});
function trip(source: string) {
  let out = "";
  editor.update(
    () => {
      $replaceWithBb(source);
      out = $exportBb();
    },
    { discrete: true },
  );
  return out;
}

// The words a text shows, in order, whatever the tags and spacing around them.
const shown = (source: string) =>
  renderBbCode(source)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, "");

function sources(count: number, seed: number) {
  const random = mulberry(seed);
  return Array.from({ length: count }, () => {
    let source = "";
    const length = 1 + Math.floor(random() * 16);
    for (let k = 0; k < length; k++) {
      source += TOKENS[Math.floor(random() * TOKENS.length)];
    }
    return source;
  });
}

test("a text made of random tags is read to the same text twice and loses no word", () => {
  const bad: string[] = [];
  for (const source of sources(6000, 42)) {
    const once = trip(source);
    const words = (text: string) =>
      (text.match(/word|other|text|İ/g) ?? []).length;
    if (trip(once) !== once || words(once) !== words(source)) {
      bad.push(`${JSON.stringify(source)} -> ${JSON.stringify(once)}`);
    }
  }
  expect(bad.slice(0, 5)).toEqual([]);
});

test("what the page shows for a text is what it shows for the text the editor writes back", () => {
  const bad: string[] = [];
  for (const source of sources(3000, 7)) {
    const once = trip(source);
    let before: string;
    let after: string;
    try {
      before = shown(source);
      after = shown(once);
    } catch {
      // A text the renderer refuses (too complex or too deep) has no page.
      continue;
    }
    if (before !== after) {
      bad.push(`${JSON.stringify(source)} -> ${JSON.stringify(once)}`);
    }
  }
  expect(bad.slice(0, 5)).toEqual([]);
});
