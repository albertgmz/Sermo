import { expect, test } from "bun:test";
import { createEditor } from "lexical";
import { $exportBb, $replaceWithBb, BB_NODES } from "./bb-lexical";

const TOKENS = [
  "[B]",
  "[/B]",
  "[I]",
  "[/I]",
  "[U]",
  "[/U]",
  "[S]",
  "[/S]",
  "[URL=https://a.test]",
  "[/URL]",
  "[URL]https://b.test[/URL]",
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
  "[/CODE]",
  "[ICODE]",
  "[/ICODE]",
  "[SPOILER]",
  "[/SPOILER]",
  "[COLOR=red]",
  "[/COLOR]",
  "[PLAIN]",
  "[/PLAIN]",
  "[CODE=rich]",
  "[/CODE]",
  "word",
  "other",
  " ",
  " ",
  "\n",
  "\n\n",
  "İ",
  "[",
  "]",
  "[IMG]https://x.test/a.png[/IMG]",
];

function rnd(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
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

test("a text made of random tags is read to the same text twice and loses no word", () => {
  const random = rnd(42);
  let unstable = 0;
  let lost = 0;
  for (let i = 0; i < 4000; i++) {
    let source = "";
    const length = 1 + Math.floor(random() * 14);
    for (let k = 0; k < length; k++)
      source += TOKENS[Math.floor(random() * TOKENS.length)];
    const once = trip(source);
    const twice = trip(once);
    if (twice !== once) {
      unstable++;
    }
    const words = (text: string) => (text.match(/word|other|İ/g) ?? []).length;
    if (words(once) !== words(source)) {
      lost++;
    }
  }
  expect(unstable).toBe(0);
  expect(lost).toBe(0);
});
