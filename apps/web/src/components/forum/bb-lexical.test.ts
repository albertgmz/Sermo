import { expect, test } from "bun:test";
import { createEditor } from "lexical";
import { $exportBb, $replaceWithBb, BB_NODES } from "./bb-lexical";
import { parseBb } from "./bb-parse";

// What the editor writes back for a BB code source it was given, as the edit form does.
function roundTrip(source: string) {
  const editor = createEditor({
    nodes: BB_NODES,
    onError: (error) => {
      throw error;
    },
  });
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

// Sources the editor writes back exactly as they are.
const SAME = [
  "Plain text.",
  "Two\nlines and\n\na second paragraph.",
  "[B]bold[/B], [I]italic[/I], [U]underline[/U] and [S]strike[/S]",
  "[B]bold [I]and italic[/I][/B]",
  "[ICODE]a_b[/ICODE] in a line",
  "[URL=https://example.com/a?b=1]a link[/URL] and [URL]https://example.com[/URL]",
  "[URL=/forums]a page of the site[/URL]",
  "[HEADING=1]One[/HEADING]\n\n[HEADING=3]Three[/HEADING]",
  "[QUOTE]quoted\ntext[/QUOTE]\n\nMy answer.",
  "[LIST]\n[*]one\n[*]two\n[/LIST]",
  "[LIST=1]\n[*]first\n[*]second\n[/LIST]",
  "[LIST]\n[*]top\n[LIST=1]\n[*]kid\n[/LIST]\n[*]next\n[/LIST]",
  "[CODE]\nconst a = 1;\n\tindented\n[/CODE]",
  "[CODE=js]\nlet x;\n[/CODE]",
  'A mention of @wren and @some_user, and @"two words".',
  // Tags the editor does not show as formatting stay in the text.
  "[COLOR=red]red[/COLOR] and [SIZE=5]big[/SIZE]",
  "[SPOILER]hidden[/SPOILER]",
  "[SPOILER=Title]hidden[/SPOILER]",
  '[QUOTE="wren, post: 12, member: 3"]quoted[/QUOTE]\n\nMy answer.',
  "[MEDIA=youtube]kQ0Eo1UccEE[/MEDIA] and [IMG]https://x.test/a.png[/IMG]",
  "[ATTACH]12[/ATTACH] [ATTACH=full]13[/ATTACH]",
  "[PLAIN][B]not bold[/B][/PLAIN]",
  "[CENTER]centered[/CENTER]",
  "[TABLE][TR][TD]a[/TD][/TR][/TABLE]",
  // Unpaired and wrong tags.
  "[B]never closed",
  // Tags with nothing in them have nothing to show, and stay.
  "[HEADING=1][/HEADING] x",
  "[LIST][/LIST]",
  "[LIST]\n[*]\n[/LIST]",
  "[QUOTE] [/QUOTE]",
  // Tags the renderer pairs that the editor shows as text pair there too.
  "[SPOILER][b]x[/SPOILER] y[/B]",
  "[COLOR=red][i]x[/COLOR] y[/I]",
  "[SPOILER][B]x[/B][/SPOILER] [B]y[/B]",
  // Rich code, and tags whose content is not what they need, are read as text.
  "[CODE=rich]a\n[LIST][*]x[/LIST]\n[HEADING=1]h[/HEADING][/CODE]",
  "[ICODE=rich]x[LIST=1]x[/LIST][/ICODE]",
  "[IMG][B]x[/B][/IMG]",
  "[ATTACH]not a number[/ATTACH]",
  '[QUOTE="a]b"]x[/QUOTE]',
  // Text after a break is not in the tags before it.
  "[ICODE]x[/ICODE]\ny",
  "[B]x[/B]\ny",
  "[B]x\ny[/B]",
  "[B][COLOR=red]x\ny[/COLOR][/B]",
  "[B][ICODE]a\nb[/ICODE][/B]",
  "[B]x [PLAIN]a\n\nb[/PLAIN] y[/B]",
  "[LIST]\n[*][B]a\n[*]b[/B]\n[/LIST]",
  "[URL]www.c.test[/URL]",
  // Capital letters of other alphabets do not shift what is found after them.
  "İİİ [ICODE]abc[/ICODE] tail",
  // The space around a link's text stays where it is.
  "see[URL=https://a.com] here[/URL] now",
  "[URL=https://a.com]here [/URL]now",
  "[B][I]x[/B][/I]",
  "never opened[/B]",
  "[URL=javascript:alert(1)]x[/URL]",
  "[HEADING=9]x[/HEADING]",
  "[*] outside a list",
  "arr[i] = [1, 2]",
  // Markdown is text.
  "**not bold** and `not code` and # not a heading\n\n- not a list\n\n> not a quote",
  "![x](https://a.test/p.png) and [a](https://a.test)",
];

for (const source of SAME) {
  test(`the editor keeps ${JSON.stringify(source.slice(0, 40))}`, () => {
    expect(roundTrip(source)).toBe(source);
  });
}

// Sources written back in the editor's own form, which then stays as it is.
const NORMALISED: [string, string][] = [
  ["[b]x[/b] [i]y[/i]", "[B]x[/B] [I]y[/I]"],
  ["a\r\nb\r\n\r\nc", "a\nb\n\nc"],
  ["a\n\n\n\nb", "a\n\nb"],
  ["  padded  \n\n  \n\nnext", "padded\n\nnext"],
  ["[URL=https://a.test]https://a.test[/URL]", "[URL]https://a.test[/URL]"],
  [
    "İstanbul [CODE]\nlet a;\n[/CODE] end",
    "İstanbul\n\n[CODE]\nlet a;\n[/CODE]\n\nend",
  ],
  [
    `[URL="https://a.test/${"x".repeat(300)}"]long[/URL]`,
    `[URL=https://a.test/${"x".repeat(300)}]long[/URL]`,
  ],
  ["[B]a[QUOTE]q[/QUOTE]b[/B]", "[B]a\n\n[QUOTE]q[/QUOTE]\n\nb[/B]"],
  [
    "text [HEADING=2]head[/HEADING] more",
    "text\n\n[HEADING=2]head[/HEADING]\n\nmore",
  ],
  ["[QUOTE]one\n\ntwo[/QUOTE]", "[QUOTE]one\n\ntwo[/QUOTE]"],
  ["[LIST]\n[*]a\n\nb\n[*]c\n[/LIST]", "[LIST]\n[*]a\n\nb\n[*]c\n[/LIST]"],
  ["[LIST][*]a[*]b[/LIST]", "[LIST]\n[*]a\n[*]b\n[/LIST]"],
  ["[LIST]\nlead\n[*]a\n[/LIST]", "[LIST]\n[*]lead\n[*]a\n[/LIST]"],
];

for (const [source, expected] of NORMALISED) {
  test(`the editor writes ${JSON.stringify(source.slice(0, 40))} back as ${JSON.stringify(expected.slice(0, 40))}`, () => {
    const once = roundTrip(source);
    expect(once).toBe(expected);
    expect(roundTrip(once)).toBe(once);
  });
}

test("a list that holds a block of another kind stays text, with its tags", () => {
  const source = "[LIST]\n[*][QUOTE]q[/QUOTE]\n[/LIST]";
  const blocks = parseBb(source);
  expect(blocks.some((block) => block.t === "list")).toBe(false);
  expect(roundTrip(source)).toContain("[QUOTE]q[/QUOTE]");
  expect(roundTrip(source)).toContain("[*]");
});

test("a link inside a link is text, not a second link", () => {
  expect(
    roundTrip("[URL=https://a.test][URL=https://b.test]x[/URL][/URL]"),
  ).toBe("[URL=https://a.test][URL=https://b.test]x[/URL][/URL]");
});

test("inline code that holds a line break is text", () => {
  expect(roundTrip("[ICODE]a\nb[/ICODE]")).toBe("[ICODE]a\nb[/ICODE]");
});

test("no source loses its content or changes its meaning when read twice", () => {
  const nasty = [
    "[B][I][U][S]x[/S][/U][/I][/B]",
    "[B]a[URL=https://x.test]b[I]c[/I][/URL]d[/B]",
    "[HEADING=1][B]x[/B] [URL=/a]y[/URL][/HEADING]",
    "[LIST][*][B]a[/B][*][URL=/a]b[/URL][/LIST]",
    "[QUOTE][B]a[/B]\nb[/QUOTE]",
    "[CODE]\n[B]x[/B] [/QUOTE]\n[/CODE]",
    "[B]a[/B][B]b[/B]",
    "[B]a[ICODE]b[/ICODE]c[/B]",
    "[ICODE]a[/ICODE][B][ICODE]b[/ICODE][/B]",
    "[QUOTE]a[/QUOTE][QUOTE]b[/QUOTE]",
    "[[B]x[/B]]",
    "[B]]x[/B][",
    "[LIST]\n[*]a\n[LIST]\n[*]b\n[/LIST]\nafter\n[*]c\n[/LIST]",
  ];
  for (const source of nasty) {
    const once = roundTrip(source);
    expect(roundTrip(once), source).toBe(once);
    // Every word of the source is still there.
    for (const word of source.match(/[a-z]+(?![^[]*\])/gi) ?? []) {
      if (
        word.length > 0 &&
        !/^(B|I|U|S|URL|LIST|QUOTE|CODE|ICODE|HEADING)$/.test(word)
      ) {
        expect(once, `${source} -> ${once}`).toContain(word);
      }
    }
  }
});

test("a text of unclosed tags is read in linear time", () => {
  for (const unit of [
    "[B]",
    "[URL=/a]",
    "[LIST][*]",
    "[CODE]",
    "[QUOTE]",
    "[a=",
    "[",
  ]) {
    const source = unit.repeat(Math.ceil(20000 / unit.length));
    const start = performance.now();
    roundTrip(source);
    expect(performance.now() - start, unit).toBeLessThan(1500);
  }
});

test("tags nest only as deep as the backend allows, and the rest is text", () => {
  const source = `${"[B]".repeat(40)}x${"[/B]".repeat(40)}`;
  expect(roundTrip(source).replace(/\[\/?B\]/g, "")).toBe("x");
});
