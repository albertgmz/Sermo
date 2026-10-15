import { expect, test } from "bun:test";
import { searchedTag, tagHref, tagsFromText, tagsToText } from "./tags";

test("a tag's address is its name, percent-encoded", () => {
  expect(tagHref("rust")).toBe("/tags/rust");
  expect(tagHref("café")).toBe("/tags/caf%C3%A9");
  expect(tagHref("año_2026")).toBe("/tags/a%C3%B1o_2026");
});

test("a field of tags is split on spaces, commas and semicolons, without the #", () => {
  expect(tagsFromText("#rust tutorial, #Zig;café")).toEqual([
    "rust",
    "tutorial",
    "Zig",
    "café",
  ]);
  expect(tagsFromText("  ")).toEqual([]);
  expect(tagsFromText("##a #a a")).toEqual(["a"]);
  // Nothing here judges a name: a bad one reaches the backend and comes back refused.
  expect(tagsFromText("two/words 123")).toEqual(["two/words", "123"]);
});

test("the tags of a thread are shown in a field as hashtags", () => {
  expect(tagsToText(["a", "b"])).toBe("#a #b");
  expect(tagsToText([])).toBe("");
  expect(tagsFromText(tagsToText(["café", "rust"]))).toEqual(["café", "rust"]);
});

test("a search box holding one hashtag asks for its tag", () => {
  expect(searchedTag("#rust")).toBe("rust");
  expect(searchedTag("  #Café ")).toBe("Café");
  expect(searchedTag("#rust tutorial")).toBeNull();
  expect(searchedTag("rust")).toBeNull();
  expect(searchedTag("#")).toBeNull();
  expect(searchedTag("##a")).toBeNull();
  expect(searchedTag("a #b")).toBeNull();
});
