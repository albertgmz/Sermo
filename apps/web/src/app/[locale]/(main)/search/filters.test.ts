import { expect, test } from "bun:test";
import { searchHref } from "./filters";

test("a search with no filters carries only the query", () => {
  expect(searchHref({ query: "soil", titlesOnly: false, author: "" })).toBe(
    "/search?q=soil",
  );
});

test("every filter travels in the address", () => {
  expect(
    searchHref({
      query: "a b&c",
      titlesOnly: true,
      forum: 3,
      prefix: 1,
      author: "ember",
    }),
  ).toBe("/search?q=a+b%26c&titles=1&forum=3&prefix=1&author=ember");
});
