import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const { TABS, tabOf } = await import("./feed-page");

test("the feed tabs are latest, hot and following", () => {
  expect([...TABS]).toEqual(["latest", "hot", "following"]);
});

test("a tab that is not a feed tab opens latest, and the former name top is not one", () => {
  expect(tabOf("hot")).toBe("hot");
  expect(tabOf("following")).toBe("following");
  expect(tabOf("top")).toBe("latest");
  expect(tabOf("nonsense")).toBe("latest");
  expect(tabOf(undefined)).toBe("latest");
});
