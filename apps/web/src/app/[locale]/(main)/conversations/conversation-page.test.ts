import { expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const { conversationsPage } = await import("./conversation-page");

test("the list asks for 40 conversations a page, from the cursor it was given", async () => {
  const asked: unknown[] = [];
  const reader = (async (_contract: unknown, input: unknown) => {
    asked.push(input);
    return { items: [], nextCursor: null };
  }) as unknown as Parameters<typeof conversationsPage>[1];
  await conversationsPage(undefined, reader);
  await conversationsPage("next", reader);
  expect(asked).toEqual([
    { cursor: undefined, limit: 40 },
    { cursor: "next", limit: 40 },
  ]);
});
