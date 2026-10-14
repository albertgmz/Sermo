import { expect, test } from "bun:test";
import { withSpoilerButtons } from "./spoiler-buttons";

test("each placeholder becomes a button holding its position and title", () => {
  const html =
    '<p>a</p><div class="bb-spoiler" data-spoiler="0"></div>' +
    '<div class="bb-spoiler" data-spoiler="1" data-spoiler-title="A &amp; &quot;B&quot;"></div>' +
    '<p>x <span class="bb-spoiler bb-spoiler-inline" data-spoiler="2"></span> y</p>';
  expect(withSpoilerButtons(html, true)).toBe(
    '<p>a</p><div class="bb-spoiler" data-spoiler="0"><button type="button" class="bb-spoiler-button" data-spoiler-button aria-expanded="false"></button></div>' +
      '<div class="bb-spoiler" data-spoiler="1"><button type="button" class="bb-spoiler-button" data-spoiler-button aria-expanded="false"><span class="bb-spoiler-title">A &amp; &quot;B&quot;</span></button></div>' +
      '<p>x <span class="bb-spoiler bb-spoiler-inline" data-spoiler="2"><button type="button" class="bb-spoiler-button" data-spoiler-button aria-expanded="false"></button></span> y</p>',
  );
});

test("without a content to ask for the buttons are disabled", () => {
  const html = '<div class="bb-spoiler" data-spoiler="0"></div>';
  expect(withSpoilerButtons(html, false)).toContain(
    'aria-expanded="false" disabled>',
  );
  expect(withSpoilerButtons(html, true)).not.toContain("disabled");
});

test("other HTML, and markup that only looks like a placeholder, is untouched", () => {
  const plain =
    '<p>no spoilers</p><details class="spoiler"><summary>S</summary>x</details>';
  expect(withSpoilerButtons(plain, true)).toBe(plain);
  for (const html of [
    '<div class="bb-spoiler" data-spoiler="0">kept</div>',
    '<div class="bb-spoiler" data-spoiler="x"></div>',
    '<div class="bb-spoiler" data-spoiler="0"></span>',
    '<div class="bb-spoiler" data-spoiler="0" onclick="x"></div>',
  ])
    expect(withSpoilerButtons(html, true)).toBe(html);
});
