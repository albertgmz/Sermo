import { expect, test } from "bun:test";
import en from "./locales/en.json";
import es from "./locales/es.json";

test("both languages hold the same phrases", () => {
  expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
});

// An award's rarity is shown to members as a colour only; its names live in the web app's panel
// text, so the backend holds no phrase for them.
test("no phrase names an award rarity", () => {
  for (const catalogue of [en, es])
    expect(Object.keys(catalogue).filter((key) => key.startsWith("award.tier."))).toEqual([]);
});
