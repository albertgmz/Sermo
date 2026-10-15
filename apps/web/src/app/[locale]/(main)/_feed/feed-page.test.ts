import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const { TABS, feedHref, tabOf } = await import("./feed-page");

test("the feed tabs are latest, following and hot", () => {
  expect([...TABS]).toEqual(["latest", "following", "hot"]);
});

test("a link to the former top tab opens hot, and every link is written with the new name", () => {
  expect(tabOf("top")).toBe("hot");
  expect(tabOf("hot")).toBe("hot");
  expect(tabOf("following")).toBe("following");
  expect(tabOf("nonsense")).toBe("latest");
  expect(tabOf(undefined)).toBe("latest");
  expect(feedHref(tabOf("top"))).toBe("/?tab=hot");
});
