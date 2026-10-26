import { expect, test } from "bun:test";
import { targetSelectors } from "./reveal";

test("a setting names its row, then the first of the rows under it", () => {
  expect(targetSelectors("?setting=levelTitles")).toEqual([
    '[data-field="levelTitles"]',
    '[data-field^="levelTitles."]',
  ]);
});

test("a permission names its row of the matrix", () => {
  expect(targetSelectors("permission=forum.guestPost")).toEqual([
    '[data-permission="forum.guestPost"]',
  ]);
});

test("a quote or a backslash in the address cannot break out of the selector", () => {
  expect(
    targetSelectors(`?permission=${encodeURIComponent('a"] b\\')}`),
  ).toEqual(['[data-permission="a\\"] b\\\\"]']);
});

test("any other address names no row", () => {
  expect(targetSelectors("")).toEqual([]);
  expect(targetSelectors("?notice=saved")).toEqual([]);
  expect(targetSelectors("?setting=")).toEqual([]);
});
