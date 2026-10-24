import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const { conversationsPage } = await import("./conversation-page");

test("the list asks for 40 conversations a page, by the page's number", async () => {
  const asked: unknown[] = [];
  const reader = (async (_contract: unknown, input: unknown) => {
    asked.push(input);
    return { items: [], nextCursor: null, total: 0 };
  }) as unknown as Parameters<typeof conversationsPage>[1];
  await conversationsPage(1, reader);
  await conversationsPage(3, reader);
  expect(asked).toEqual([
    { page: 1, limit: 40 },
    { page: 3, limit: 40 },
  ]);
});
