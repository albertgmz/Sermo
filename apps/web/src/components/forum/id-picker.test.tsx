import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  type Choice,
  enterChoice,
  IdPicker,
  isFull,
  offered,
  runSearch,
  without,
} from "./id-picker";

// There is no browser here, so the behaviour of the picker is held in the small functions it is
// made of (what is offered, what Enter does, what a search answers) and in what it draws.
const ember: Choice = { id: 1, label: "ember" };
const emery: Choice = { id: 2, label: "emery" };
const emil: Choice = { id: 3, label: "emil" };
const found = [ember, emery, emil];

const text = {
  chosen: "Chosen",
  search: "Search",
  placeholder: "Type",
  noMatch: "No match.",
  remove: (name: string) => `Remove ${name}`,
};

test("everything found is offered, minus the chosen and the excluded", () => {
  const found_ = { prefix: "e", items: found };
  const base = { query: "e", ids: [], found: found_ };
  expect(offered(base).shown).toEqual(found);
  expect(offered({ ...base, ids: [2] }).shown).toEqual([ember, emil]);
  expect(offered({ ...base, exclude: [1, 3] }).shown).toEqual([emery]);
  expect(offered({ ...base, ids: [2], exclude: [1, 3] }).shown).toEqual([]);
});

test("a fixed list is filtered by what is typed and always on show", () => {
  const options = [
    { id: 1, label: "Moderators" },
    { id: 2, label: "Veterans" },
  ];
  const base = { ids: [], found: null, options };
  expect(offered({ ...base, query: "" })).toEqual({
    shown: options,
    settled: true,
    listed: true,
  });
  expect(offered({ ...base, query: " MOD " }).shown).toEqual([options[0]]);
  expect(offered({ ...base, query: "zzz" })).toEqual({
    shown: [],
    settled: true,
    listed: true,
  });
});

test("an answer for older text is never offered or picked for newer text", () => {
  const old = { prefix: "al", items: found };
  const now = offered({ query: "alb", ids: [], found: old });
  expect(now).toEqual({ shown: [], settled: false, listed: false });
  expect(enterChoice("alb", now.shown)).toBeUndefined();
  // Once it answers for the text held, it is offered.
  expect(offered({ query: "al", ids: [], found: old }).shown).toEqual(found);
});

test("while the answer for the new text is pending, the earlier choices that still match stay on show", () => {
  const earlier = { prefix: "e", items: found };
  const pending = offered({ query: "emi", ids: [], found: earlier });
  expect(pending.shown).toEqual([emil]);
  expect(pending.listed).toBe(true);
  expect(pending.settled).toBe(false);
  // Nothing matches the new text yet: no list, and no "No match" before the answer.
  expect(offered({ query: "x", ids: [], found: earlier })).toEqual({
    shown: [],
    settled: false,
    listed: false,
  });
  // The chosen are still left out of the earlier choices.
  expect(offered({ query: "em", ids: [2], found: earlier }).shown).toEqual([
    ember,
    emil,
  ]);
});

test("Enter on an empty box chooses nothing, on typed text the first match", () => {
  expect(enterChoice("", found)).toBeUndefined();
  expect(enterChoice("   ", found)).toBeUndefined();
  expect(enterChoice("e", found)).toBe(ember);
  expect(enterChoice("zzz", [])).toBeUndefined();
});

test("a search that fails answers with nothing, which the picker shows as no match", async () => {
  const failing = async () => {
    throw new Error("offline");
  };
  const answer = await runSearch(failing, "em");
  expect(answer).toEqual({ prefix: "em", items: [] });
  expect(offered({ query: "em", ids: [], found: answer })).toEqual({
    shown: [],
    settled: true,
    listed: true,
  });
  expect(await runSearch(async () => found, "e")).toEqual({
    prefix: "e",
    items: found,
  });
});

test("single mode is full once one is chosen; the limit applies to several", () => {
  expect(isFull([], true, Number.POSITIVE_INFINITY)).toBe(false);
  expect(isFull([4], true, Number.POSITIVE_INFINITY)).toBe(true);
  expect(isFull([4, 5], false, Number.POSITIVE_INFINITY)).toBe(false);
  expect(isFull([4, 5], false, 2)).toBe(true);
});

test("taking one chip out of a repeated id leaves the other", () => {
  expect(without([3, 3, 4], 0)).toEqual([3, 4]);
  expect(without([3, 3, 4], 1)).toEqual([3, 4]);
  expect(without([3, 3, 4], 2)).toEqual([3, 3]);
});

const draw = (props: Partial<Parameters<typeof IdPicker>[0]>) =>
  renderToStaticMarkup(
    <IdPicker
      ids={[]}
      known={found}
      text={text}
      onChange={() => {}}
      {...props}
    />,
  );

test("single mode hides the search while one is chosen and brings it back when it is removed", () => {
  const chosen = draw({ single: true, ids: [2], options: found });
  expect(chosen).toContain("emery");
  expect(chosen).toContain('aria-label="Remove emery"');
  expect(chosen).not.toContain('type="search"');
  const removed = draw({ single: true, ids: [], options: found });
  expect(removed).toContain('type="search"');
  expect(removed).not.toContain('aria-label="Remove');
});

test("a repeated id is drawn as two chips, an unknown one by its number", () => {
  const html = draw({ ids: [3, 3, 99], options: found });
  expect(html.match(/aria-label="Remove emil"/g)?.length).toBe(2);
  expect(html).toContain("#99");
  expect(html).toContain('aria-label="Chosen"');
});

test("a search with nothing found says so; a fixed list with no match does too", () => {
  expect(draw({ options: [] })).toContain("No match.");
  expect(draw({ options: found })).not.toContain("No match.");
  // A search says nothing until it has answered.
  expect(draw({ search: async () => found })).not.toContain("No match.");
});

test("a picker with a visible label gives its box that label's id and no label of its own", () => {
  const { search: _unused, ...withoutSearch } = text;
  const html = draw({ inputId: "who", text: withoutSearch, options: found });
  const box = html.match(/<input[^>]*>/)?.[0] ?? "";
  expect(box).toContain('id="who"');
  expect(box).not.toContain("aria-label");
});

test("a picker without a visible label still names its box", () => {
  const box = draw({ options: found }).match(/<input[^>]*>/)?.[0] ?? "";
  expect(box).toContain('aria-label="Search"');
});

test("the box carries the field name, so what was typed is sent when nothing was chosen", () => {
  const box =
    draw({ inputName: "author", options: found }).match(/<input[^>]*>/)?.[0] ??
    "";
  expect(box).toContain('name="author"');
});
