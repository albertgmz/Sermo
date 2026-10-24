import { expect, mock, test } from "bun:test";
import { renderToReadableStream } from "react-dom/server";
import { withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));

const { ConversationPages } = await import("./conversation-page");

async function html(page: number, total: number) {
  const rows = [{ key: "5", node: <span>Plans</span> }];
  const stream = await renderToReadableStream(
    withIntl(<ConversationPages page={page} list={{ rows, total }} />),
  );
  await stream.allReady;
  return new Response(stream).text();
}

test("the list of conversations is numbered pages of 40, linked by number", async () => {
  // Ninety conversations: three pages.
  const drawn = await html(2, 90);
  expect(drawn).toContain("Plans");
  expect(drawn).toContain('href="/conversations"');
  expect(drawn).toContain('href="/conversations?page=3"');
  expect(drawn).not.toContain('href="/conversations?page=4"');
  expect(drawn).toMatch(/aria-current="page"[^>]*>2</);
});

test("a list of one page has no pager", async () => {
  expect(await html(1, 40)).not.toContain("?page=");
});
