import { afterEach, beforeEach, mock, test } from "bun:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
const asked: { method: string; url: string; body: unknown }[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: {} };

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const actions = await import("./actions");

const ROOT = "http://127.0.0.1:8787/api/v1";

beforeEach(() => {
  asked.length = 0;
  answer = { status: 200, body: {} };
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({
      method: init.method ?? "GET",
      url,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return Response.json(answer.body, { status: answer.status });
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

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
};

test("watching a forum sends the mode and the email choice, then shows the forum", async () => {
  answer = {
    status: 200,
    body: { watching: true, mode: "posts", email: true },
  };
  const digest = await redirectedTo(() =>
    actions.watchForumAction(4, {}, form({ mode: "posts", email: "on" })),
  );
  assert.match(digest ?? "", /;\/forums\/4;/);
  assert.equal(asked[0].method, "PUT");
  assert.equal(asked[0].url, `${ROOT}/nodes/4/watch`);
  assert.deepEqual(asked[0].body, { mode: "posts", email: true });
});

test("an unknown mode watches new threads only", async () => {
  answer = {
    status: 200,
    body: { watching: true, mode: "threads", email: false },
  };
  await redirectedTo(() =>
    actions.watchForumAction(4, {}, form({ mode: "everything" })),
  );
  assert.deepEqual(asked[0].body, { mode: "threads", email: false });
});

test("stopping watching a forum", async () => {
  answer = { status: 200, body: { ok: true } };
  const digest = await redirectedTo(() => actions.unwatchForumAction(4, {}));
  assert.match(digest ?? "", /;\/forums\/4;/);
  assert.equal(asked[0].method, "DELETE");
  assert.equal(asked[0].url, `${ROOT}/nodes/4/watch`);
});

test("the backend's refusal of a watch is what the form shows", async () => {
  answer = {
    status: 403,
    body: { error: { code: "forbidden", message: "Not for you." } },
  };
  assert.deepEqual(await actions.watchForumAction(4, {}, form({})), {
    error: "Not for you.",
  });
  assert.deepEqual(await actions.unwatchForumAction(4, {}), {
    error: "Not for you.",
  });
});

test("starting a thread names the attached files and refuses them when they are not ids", async () => {
  answer = {
    status: 403,
    body: { error: { code: "forbidden", message: "No." } },
  };
  const data = form({ title: "T", body: "B" });
  data.append("attachmentIds", "9");
  assert.deepEqual(await actions.createThreadAction(4, {}, data), {
    error: "No.",
    title: "T",
    prefixId: "",
  });
  assert.deepEqual(asked[0].body, {
    title: "T",
    body: "B",
    attachmentIds: [9],
    prefixId: null,
  });
  const bad = form({ title: "T", body: "B" });
  bad.append("attachmentIds", "0");
  await assert.rejects(() => actions.createThreadAction(4, {}, bad));
});

test("an id that is not a record id never becomes a path", async () => {
  for (const id of [".." as unknown as number, 0, -3, Number.NaN]) {
    await assert.rejects(() => actions.watchForumAction(id, {}, form({})));
    await assert.rejects(() => actions.unwatchForumAction(id, {}));
    await assert.rejects(() => actions.createThreadAction(id, {}, form({})));
  }
  assert.equal(asked.length, 0);
});
