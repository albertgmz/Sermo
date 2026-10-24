import { afterEach, beforeEach, expect, mock, test } from "bun:test";

const realFetch = globalThis.fetch;
const asked: { method: string; url: string; body: unknown }[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: {} };

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {}, get: () => undefined }),
}));

const { previewAction } = await import("./preview");

beforeEach(() => {
  asked.length = 0;
  answer = { status: 200, body: { html: "<p><strong>Bold</strong></p>" } };
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({
      method: init.method ?? "GET",
      url: String(url),
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return Response.json(answer.body, { status: answer.status });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("a preview asks the backend to render the text where it would be posted, and draws its answer", async () => {
  const shown = await previewAction(
    { type: "thread", nodeId: 4 },
    "[b]Bold[/b]",
  );
  expect("preview" in shown).toBe(true);
  expect(asked).toHaveLength(1);
  expect(asked[0].method).toBe("POST");
  expect(asked[0].url).toEndWith("/api/v1/posts/preview");
  expect(asked[0].body).toEqual({
    target: { type: "thread", nodeId: 4 },
    body: "[b]Bold[/b]",
  });
});

test("only the target's own fields reach the backend, and its ids are checked", async () => {
  await previewAction(
    { type: "reply", threadId: 7, nodeId: 3 } as never,
    "Text",
  );
  expect((asked[0].body as { target: unknown }).target).toEqual({
    type: "reply",
    threadId: 7,
  });
  await expect(
    previewAction({ type: "thread", nodeId: 0 }, "Text"),
  ).rejects.toThrow();
  expect(asked).toHaveLength(1);
});

test("a refused preview says why, in the backend's words", async () => {
  answer = {
    status: 403,
    body: {
      error: { code: "forbidden", message: "You cannot post links yet." },
    },
  };
  expect(
    await previewAction({ type: "message", conversationId: 9 }, "Text"),
  ).toEqual({ error: "You cannot post links yet." });
});
