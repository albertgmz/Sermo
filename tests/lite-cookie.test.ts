import { expect, test } from "bun:test";
import {
  blocks,
  LITE_CATEGORIES,
  parseLiteCookie,
  serializeLiteCookie,
} from "../src/lib/lite-preferences";

test("every subset round-trips in registry order and blocks exactly its categories", () => {
  for (let mask = 0; mask < 2 ** LITE_CATEGORIES.length; mask++) {
    const selected = LITE_CATEGORIES.filter(
      (_, index) => mask & (1 << index),
    ).map(({ key }) => key);
    const state = { master: false, blocked: selected };
    const cookie = serializeLiteCookie(state);
    expect(cookie).toBe(selected.join("."));
    expect(parseLiteCookie(cookie)).toEqual(state);
    expect(
      serializeLiteCookie({ ...state, blocked: [...selected].reverse() }),
    ).toBe(cookie);
    for (const { key } of LITE_CATEGORIES) {
      expect(blocks(state, key)).toBe(selected.includes(key));
      expect(blocks({ ...state, master: true }, key)).toBe(true);
    }
    expect(serializeLiteCookie({ ...state, master: true })).toBe("all");
  }
});

test("legacy, empty, unknown, whitespace and duplicate tokens have stable canonical forms", () => {
  const examples: [string | undefined, string][] = [
    [undefined, ""],
    ["", ""],
    [" ", ""],
    ["\t\n", ""],
    ["all", "all"],
    ["1", "all"],
    ["unknown", ""],
    ["all.avatars", "avatars"],
    ["1.frames", "frames"],
    [" all ", ""],
    [" avatars ", ""],
    ["avatars. .frames", "avatars.frames"],
    ["frames.unknown.avatars.frames", "avatars.frames"],
    [".avatars..frames.", "avatars.frames"],
    ["AVATARS", ""],
  ];
  for (const [input, canonical] of examples) {
    const state = parseLiteCookie(input);
    expect(serializeLiteCookie(state), `cookie ${JSON.stringify(input)}`).toBe(
      canonical,
    );
    expect(parseLiteCookie(canonical)).toEqual(state);
    for (const { key } of LITE_CATEGORIES)
      expect(blocks(state, key)).toBe(
        canonical === "all" || canonical.split(".").includes(key),
      );
  }
  const allSelected = parseLiteCookie(
    LITE_CATEGORIES.map(({ key }) => key).join("."),
  );
  expect(allSelected.master).toBe(false);
  expect(allSelected.blocked.length).toBe(LITE_CATEGORIES.length);
});
