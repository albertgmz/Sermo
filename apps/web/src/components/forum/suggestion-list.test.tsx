import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Matched,
  SuggestionList,
  shownBand,
  suggestionPlace,
} from "./suggestion-list";

const list = (options: string[], active = 0) =>
  renderToStaticMarkup(
    <SuggestionList
      owner={null}
      label="Emoji"
      status={options.length ? `${options.length} found` : ""}
      options={options}
      active={active}
      optionKey={(option) => option}
      renderOption={(option) => option}
      onPick={() => {}}
    />,
  );

test("the list is a named listbox of options, the active one selected, each with its own id", () => {
  const html = list(["🤔", "🔥"], 1);
  expect(html).toContain('role="listbox"');
  expect(html).toContain('aria-label="Emoji"');
  const options = [
    ...html.matchAll(
      /<div id="([^"]+)" role="option"[^>]*aria-selected="(true|false)"/g,
    ),
  ];
  expect(options.map((found) => found[2])).toEqual(["false", "true"]);
  const listId = /<div[^>]*id="([^"]+)"[^>]*role="listbox"/.exec(html)?.[1];
  expect(listId).toBeTruthy();
  expect(options.map((found) => found[1])).toEqual([
    `${listId}-0`,
    `${listId}-1`,
  ]);
  expect(html).toContain('role="status"');
  expect(html).toContain("2 found");
});

test("with nothing to offer only the empty status is drawn", () => {
  const html = list([]);
  expect(html).not.toContain("listbox");
  expect(html).toContain('role="status"');
});

test("the list's colours are the theme's tokens, and the options are tall enough to touch", () => {
  const html = list(["🤔"]);
  expect(html).toContain("bg-popover");
  expect(html).toContain("text-popover-foreground");
  expect(html).toContain("min-h-11");
});

const box = { top: 100, left: 20, width: 400 };
const list300 = { width: 288, height: 120 };

test("the list goes under the caret's line, from the caret's left", () => {
  expect(
    suggestionPlace({ top: 200, bottom: 220, left: 120 }, box, list300, {
      top: 0,
      bottom: 800,
    }),
  ).toEqual({ top: 124, left: 92 });
});

test("with no room under the line (a phone's keyboard), it goes over it", () => {
  expect(
    suggestionPlace({ top: 300, bottom: 320, left: 120 }, box, list300, {
      top: 0,
      bottom: 400,
    }),
  ).toEqual({ top: 76, left: 92 });
});

test("with room neither under nor over, it stays under", () => {
  expect(
    suggestionPlace({ top: 60, bottom: 80, left: 120 }, box, list300, {
      top: 0,
      bottom: 150,
    }).top,
  ).toBe(-16);
});

test("it never leaves its box sideways", () => {
  const caret = (left: number) => ({ top: 200, bottom: 220, left });
  const shown = { top: 0, bottom: 800 };
  expect(suggestionPlace(caret(400), box, list300, shown).left).toBe(112);
  expect(suggestionPlace(caret(10), box, list300, shown).left).toBe(0);
});

test("what was typed is in bold where the text holds it", () => {
  expect(
    renderToStaticMarkup(<Matched text="cara_pensativa" query="PENSA" />),
  ).toBe(
    'cara_<strong class="font-semibold text-foreground">pensa</strong>tiva',
  );
  expect(renderToStaticMarkup(<Matched text="fire" query="xyz" />)).toBe(
    "fire",
  );
});

test("inside a box that clips it (a dialog's scroll box), the list goes over the caret when the box has no room under it", () => {
  const screen = { top: 0, bottom: 800 };
  const scrollBox = { top: 150, bottom: 340 };
  expect(shownBand([screen, scrollBox])).toEqual({ top: 150, bottom: 340 });
  expect(
    suggestionPlace(
      { top: 300, bottom: 320, left: 120 },
      box,
      list300,
      shownBand([screen, scrollBox]),
    ).top,
  ).toBe(76);
});
