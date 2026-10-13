import { afterEach, beforeEach, mock, test } from "bun:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
const asked: { url: string; body: unknown }[] = [];

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { commentOnWallPost, postToWall } = await import("./actions");

beforeEach(() => {
  asked.length = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({ url, body: JSON.parse(String(init.body)) });
    // Not a post: the action answers with an error instead of a redirect, which is enough to see
    // what was asked.
    return Response.json({});
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const one of [value].flat()) data.append(name, one);
  }
  return data;
};

test("a wall post names the files attached to it", async () => {
  await postToWall(
    5,
    "/members/5",
    {},
    form({ body: "hi", attachmentIds: ["4", "5"] }),
  );
  assert.deepEqual(asked, [
    {
      url: "http://127.0.0.1:8787/api/v1/users/5/profile-posts",
      body: { body: "hi", attachmentIds: [4, 5] },
    },
  ]);
});

test("an attachment id that is not a record id never reaches the backend", async () => {
  await assert.rejects(() =>
    postToWall(5, "/members/5", {}, form({ body: "hi", attachmentIds: "x" })),
  );
  assert.equal(asked.length, 0);
});

test("a comment carries no files: the backend takes none for it", async () => {
  await commentOnWallPost(
    8,
    "/members/5",
    {},
    form({ body: "hi", attachmentIds: ["4"] }),
  );
  assert.deepEqual(asked[0].body, { body: "hi" });
});
