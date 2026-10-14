import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("@/app/[locale]/(main)/conversations/actions", () => ({
  findRecipients: async () => [],
}));
const { offered } = await import("./recipient-picker");

const ember = { id: 1, username: "ember" };
const emery = { id: 2, username: "emery" };
const emil = { id: 3, username: "emil" };
const found = [ember, emery, emil];

test("everything found is offered when nobody is chosen or excluded", () => {
  expect(offered(found, [], [])).toEqual(found);
});

test("a member already chosen is not offered again", () => {
  expect(offered(found, [emery], [])).toEqual([ember, emil]);
});

test("members who must be left out are never offered", () => {
  expect(offered(found, [], [1, 3])).toEqual([emery]);
  expect(offered(found, [emery], [1, 3])).toEqual([]);
});
