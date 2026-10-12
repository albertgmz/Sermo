import { afterEach, beforeEach, mock, test } from "bun:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
const asked: { method: string; url: string }[] = [];

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { leaveAction, markRead } = await import("./actions");
const { markOneRead } = await import("../notifications/actions");

beforeEach(() => {
  asked.length = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({ method: init.method ?? "GET", url });
    return Response.json({ ok: true });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return undefined;
}

test("leaving a conversation asks the backend about that conversation and goes to the list", async () => {
  const digest = await redirectedTo(() => leaveAction(7, {}));
  assert.match(digest ?? "", /^NEXT_REDIRECT;[a-z]+;\/conversations;/);
  assert.deepEqual(asked, [
    {
      method: "POST",
      url: "http://127.0.0.1:8787/api/v1/conversations/7/leave",
    },
  ]);
});

test("a conversation id that is not a record id never becomes a path", async () => {
  for (const id of [".." as unknown as number, 0, -3, Number.NaN]) {
    await assert.rejects(() => leaveAction(id, {}));
    await assert.rejects(() => markRead(id));
    await assert.rejects(() => markOneRead(id));
  }
  assert.equal(asked.length, 0);
});
