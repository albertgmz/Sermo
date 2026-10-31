import { expect, test } from "bun:test";
import { searchedTag, tagHref, tagsFromText, tagsToText } from "./tags";

test("a tag's address is its name, percent-encoded", () => {
  expect(tagHref("rust")).toBe("/tags/rust");
  expect(tagHref("café")).toBe("/tags/caf%C3%A9");
  expect(tagHref("año_2026")).toBe("/tags/a%C3%B1o_2026");
});

test("a tag with a hyphen and one with an underscore have two addresses", () => {
  expect(tagHref("rust-lang")).toBe("/tags/rust-lang");
  expect(tagHref("rust_lang")).toBe("/tags/rust_lang");
  expect(tagHref("año-2026")).toBe("/tags/a%C3%B1o-2026");
});

test("a field keeps the hyphen of a name for the backend to judge", () => {
  expect(tagsFromText("#rust-lang, a-b_c -x y-")).toEqual([
    "rust-lang",
    "a-b_c",
    "-x",
    "y-",
  ]);
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
  expect(searchedTag("#rust-lang")).toBe("rust-lang");
  expect(searchedTag("#")).toBeNull();
  expect(searchedTag("##a")).toBeNull();
  expect(searchedTag("a #b")).toBeNull();
});
