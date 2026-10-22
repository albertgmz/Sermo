import { expect, test } from "bun:test";
import { type Smilie, withSmilies } from "./smilies";

const SMILIES: Smilie[] = [
  { id: 4, title: "Mad", codes: [":mad:", ">:(", ":@"], emoji: "😡" },
  { id: 17, title: "Laugh", codes: [":LOL:"], emoji: "😆" },
  { id: 22, title: "Thumbs up", codes: ["(y)", ":like:"], emoji: "👍" },
  { id: 40, title: "Long", codes: [":like:s"], emoji: "💯" },
];

const laugh =
  '<span class="smilie" role="img" aria-label="Laugh" title="Laugh :LOL:">😆</span>';

test("a code in the text becomes its emoji, named by the smilie's title and code", () => {
  expect(withSmilies("<p>jaja :LOL: muy bueno</p>", SMILIES)).toBe(
    `<p>jaja ${laugh} muy bueno</p>`,
  );
});

test("codes need no space around them and match case-sensitively, as XenForo's do", () => {
  expect(withSmilies("<p>ok:LOL::LOL: :lol:</p>", SMILIES)).toBe(
    `<p>ok${laugh}${laugh} :lol:</p>`,
  );
});

test("every code of a smilie is replaced, the escaped ones included, the longest first", () => {
  const html = withSmilies("<p>&gt;:( (y) :like: :like:s</p>", SMILIES);
  expect(html).toContain('title="Mad &gt;:(">😡</span>');
  expect(html).toContain('title="Thumbs up (y)">👍</span>');
  expect(html).toContain('title="Thumbs up :like:">👍</span>');
  expect(html).toContain('title="Long :like:s">💯</span>');
});

test("codes inside code, links, mentions, plain text, cites and spoiler titles stay as typed", () => {
  const html = [
    "<p><code>:LOL:</code></p>",
    '<div class="bb-code"><div class="bb-code-header"></div><pre><code>a :LOL: b</code></pre></div>',
    '<p><a href="https://x.test/:LOL:">see :LOL:</a></p>',
    '<p><a href="/members/3" class="mention" data-user-id="3">@:LOL:</a></p>',
    '<div class="bb-plain"><div>:LOL:</div> :LOL:</div>',
    '<blockquote class="bb-quote"><cite class="bb-quote-author">:LOL:</cite><p>x</p></blockquote>',
    '<details class="spoiler"><summary class="bb-spoiler-summary bb-has-title">:LOL:</summary><p>y</p></details>',
  ].join("");
  expect(withSmilies(html, SMILIES)).toBe(html);
});

test("text after a skipped element and in attributes is handled right", () => {
  expect(
    withSmilies(
      '<p><code>:LOL:</code> :LOL:<br><img src="/a:LOL:.png" alt=":LOL:"> (y)</p>',
      SMILIES,
    ),
  ).toBe(
    `<p><code>:LOL:</code> ${laugh}<br><img src="/a:LOL:.png" alt=":LOL:"> <span class="smilie" role="img" aria-label="Thumbs up" title="Thumbs up (y)">👍</span></p>`,
  );
});

test("a body without smilies, or a site without them, comes back as it is", () => {
  const html = "<p>nada que ver: 10:30 (yo)</p>";
  expect(withSmilies(html, SMILIES)).toBe(html);
  expect(withSmilies("<p>:LOL:</p>", [])).toBe("<p>:LOL:</p>");
});

test("a smilie's title is escaped", () => {
  expect(
    withSmilies("<p>:x:</p>", [
      { id: 1, title: 'a "b" <c>', codes: [":x:"], emoji: "x" },
    ]),
  ).toBe(
    '<p><span class="smilie" role="img" aria-label="a &quot;b&quot; &lt;c&gt;" title="a &quot;b&quot; &lt;c&gt; :x:">x</span></p>',
  );
});

test("an entity in the text is never cut by a code that starts with its last character", () => {
  const wink = [{ id: 3, title: "Wink", codes: [";)"], emoji: "😉" }];
  expect(withSmilies("<p>fine&#39;) ;)</p>", wink)).toBe(
    '<p>fine&#39;) <span class="smilie" role="img" aria-label="Wink" title="Wink ;)">😉</span></p>',
  );
});
