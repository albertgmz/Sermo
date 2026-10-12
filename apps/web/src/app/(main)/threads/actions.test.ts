import { afterEach, beforeEach, mock, test } from "bun:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
const asked: { method: string; url: string; body: unknown }[] = [];
type Answer = { status: number; body: unknown };
let answer: Answer = { status: 200, body: {} };
// What the fake backend says to a request whose answer depends on what it is.
let byUrl: (url: string, method: string) => Answer | undefined = () =>
  undefined;

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));
mock.module("next/cache", () => ({ refresh: () => {} }));
mock.module("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

const actions = await import("./actions");

const when = "2026-01-01T00:00:00.000Z";
const someone = { id: 3, username: "ember" };
const thread = {
  id: 7,
  nodeId: 2,
  node: { id: 2, title: "Forum" },
  title: "A thread",
  prefix: null,
  excerpt: "",
  cover: null,
  highlightedUntil: null,
  bumpedAt: null,
  author: someone,
  state: "visible",
  isSticky: false,
  isLocked: false,
  createdAt: when,
  replyCount: 0,
  viewCount: 0,
  firstPostId: 1,
  lastPost: { postId: 1, position: 0, postedAt: when, user: someone },
  readPosition: null,
  isUnread: false,
};
const post = {
  id: 31,
  threadId: 7,
  position: 25,
  author: someone,
  state: "visible",
  createdAt: when,
  editedAt: null,
  bodyHtml: "",
  attachmentCount: 0,
  attachments: [],
  reactions: { counts: {}, total: 0, mine: null },
  canEdit: true,
  canDelete: true,
  bodySource: "",
};
const ROOT = "http://127.0.0.1:8787/api/v1";

beforeEach(() => {
  asked.length = 0;
  answer = { status: 200, body: {} };
  byUrl = () => undefined;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({
      method: init.method ?? "GET",
      url,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const given = byUrl(url, init.method ?? "GET") ?? answer;
    return Response.json(given.body, { status: given.status });
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

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const each of Array.isArray(value) ? value : [value]) {
      data.append(name, each);
    }
  }
  return data;
};

const refusal = {
  status: 403,
  body: { error: { code: "forbidden", message: "You may not do that." } },
};

test("a refusal of the backend is what the form shows", async () => {
  answer = refusal;
  const shown = { error: "You may not do that." };
  assert.deepEqual(
    await actions.deletePostAction(7, 31, {}, form({ reason: "x" })),
    shown,
  );
  assert.deepEqual(await actions.setLockedAction(7, true, {}), shown);
  assert.deepEqual(
    await actions.editPostAction(7, 31, {}, form({ body: "text" })),
    shown,
  );
  assert.deepEqual(
    await actions.reportPostAction(31, {}, form({ reason: "spam" })),
    shown,
  );
});

test("editing a post sends the source and goes back to the post", async () => {
  answer = { status: 200, body: post };
  const digest = await redirectedTo(() =>
    actions.editPostAction(
      7,
      31,
      {},
      form({ body: "**bold** [a](https://x.y)", reason: "typo" }),
    ),
  );
  assert.match(digest ?? "", /;\/threads\/7\?page=2#post-31;/);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].method, "PATCH");
  assert.equal(asked[0].url, `${ROOT}/posts/31`);
  assert.deepEqual(asked[0].body, {
    body: "**bold** [a](https://x.y)",
    reason: "typo",
    attachmentIds: [],
  });
});

test("an opening post edit saves the title first", async () => {
  answer = { status: 200, body: post };
  byUrl = (url) =>
    url.endsWith("/threads/7") ? { status: 200, body: thread } : undefined;
  await redirectedTo(() =>
    actions.editPostAction(
      7,
      31,
      {},
      form({ body: "b", title: "New title", prefixId: "" }),
    ),
  );
  assert.equal(asked.length, 2);
  assert.equal(asked[0].url, `${ROOT}/threads/7`);
  assert.equal((asked[0].body as { title: string }).title, "New title");
  assert.equal((asked[0].body as { prefixId: null }).prefixId, null);
  assert.equal(asked[1].url, `${ROOT}/posts/31`);
});

test("a refused title keeps the post as it was", async () => {
  answer = refusal;
  const state = await actions.editPostAction(
    7,
    31,
    {},
    form({ body: "b", title: "T", prefixId: "" }),
  );
  assert.deepEqual(state, { error: "You may not do that." });
  assert.equal(asked.length, 1);
});

test("replying names the attached files", async () => {
  answer = { status: 200, body: post };
  await redirectedTo(() =>
    actions.replyAction(7, {}, form({ body: "hi", attachmentIds: ["4", "5"] })),
  );
  assert.deepEqual(asked[0].body, { body: "hi", attachmentIds: [4, 5] });
});

test("deleting asks for the reason and restoring needs none", async () => {
  answer = { status: 200, body: post };
  const digest = await redirectedTo(() =>
    actions.deletePostAction(7, 31, {}, form({ reason: "off topic" })),
  );
  assert.match(digest ?? "", /#post-31;/);
  assert.equal(asked[0].method, "DELETE");
  assert.match(asked[0].url, /\/posts\/31\?/);
  assert.match(asked[0].url, /reason=off\+topic/);
  await redirectedTo(() => actions.restorePostAction(7, 31, {}));
  assert.equal(asked[1].url, `${ROOT}/posts/31/restore`);
});

test("sticking, locking and watching go back to the thread", async () => {
  answer = { status: 200, body: thread };
  byUrl = (url, method) =>
    url.endsWith("/watch")
      ? {
          status: 200,
          body:
            method === "PUT" ? { watching: true, email: true } : { ok: true },
        }
      : undefined;
  for (const run of [
    () => actions.setStickyAction(7, true, {}),
    () => actions.setLockedAction(7, false, {}),
    () => actions.watchThreadAction(7, {}, form({ email: "on" })),
    () => actions.unwatchThreadAction(7, {}),
    () => actions.removeCoverAction(7, {}),
    () => actions.restoreThreadAction(7, {}),
    () => actions.deleteThreadAction(7, {}, form({ reason: "" })),
  ]) {
    assert.match((await redirectedTo(run)) ?? "", /;\/threads\/7;/);
  }
  assert.equal(asked.length, 7);
  assert.equal((asked[0].body as { isSticky: boolean }).isSticky, true);
  assert.equal((asked[2].body as { email: boolean }).email, true);
});

test("moving needs a forum, and sends its id", async () => {
  assert.deepEqual(await actions.moveThreadAction(7, {}, form({})), {
    error: "noForum",
  });
  assert.equal(asked.length, 0);
  answer = { status: 200, body: thread };
  await redirectedTo(() =>
    actions.moveThreadAction(7, {}, form({ nodeId: "3" })),
  );
  assert.equal(asked[0].url, `${ROOT}/threads/7/move`);
  assert.equal((asked[0].body as { nodeId: number }).nodeId, 3);
});

test("merging takes a thread number or address and goes to the target", async () => {
  assert.deepEqual(
    await actions.mergeThreadAction(7, {}, form({ target: "nonsense" })),
    { error: "notThread" },
  );
  assert.equal(asked.length, 0);
  answer = { status: 200, body: { thread, completed: true } };
  const digest = await redirectedTo(() =>
    actions.mergeThreadAction(
      7,
      {},
      form({ target: "http://localhost:3111/threads/12-a-title" }),
    ),
  );
  assert.match(digest ?? "", /;\/threads\/12;/);
  assert.equal(asked[0].url, `${ROOT}/threads/12/merge`);
  assert.deepEqual(
    (asked[0].body as { sourceThreadIds: number[] }).sourceThreadIds,
    [7],
  );
});

test("splitting needs posts and a forum, and goes to the new thread", async () => {
  assert.deepEqual(
    await actions.splitThreadAction(7, {}, form({ nodeId: "3", title: "t" })),
    { error: "noPosts" },
  );
  assert.deepEqual(
    await actions.splitThreadAction(7, {}, form({ postIds: ["31"] })),
    { error: "noForum" },
  );
  assert.equal(asked.length, 0);
  answer = {
    status: 200,
    body: { thread: { ...thread, id: 40 }, completed: true },
  };
  const digest = await redirectedTo(() =>
    actions.splitThreadAction(
      7,
      {},
      form({ postIds: ["31", "32"], nodeId: "3", title: "Split" }),
    ),
  );
  assert.match(digest ?? "", /;\/threads\/40;/);
  assert.deepEqual((asked[0].body as { postIds: number[] }).postIds, [31, 32]);
});

test("reporting a post confirms once the backend has taken it", async () => {
  answer = { status: 200, body: { id: 1, groupId: 1 } };
  assert.deepEqual(
    await actions.reportPostAction(31, {}, form({ reason: "spam" })),
    { done: true },
  );
  assert.deepEqual(asked[0].body, {
    target: { type: "post", id: 31 },
    reason: "spam",
  });
});

test("an id that is not a record id never becomes a path", async () => {
  for (const id of [".." as unknown as number, 0, -3, Number.NaN]) {
    await assert.rejects(() => actions.editPostAction(id, 1, {}, form({})));
    await assert.rejects(() => actions.deletePostAction(1, id, {}, form({})));
    await assert.rejects(() => actions.restorePostAction(id, 1, {}));
    await assert.rejects(() => actions.setStickyAction(id, true, {}));
    await assert.rejects(() => actions.setLockedAction(id, true, {}));
    await assert.rejects(() => actions.removeCoverAction(id, {}));
    await assert.rejects(() => actions.watchThreadAction(id, {}, form({})));
    await assert.rejects(() => actions.unwatchThreadAction(id, {}));
    await assert.rejects(() => actions.reportPostAction(id, {}, form({})));
    await assert.rejects(() => actions.quoteSource(id));
    await assert.rejects(() => actions.markRead(id, 0));
    await assert.rejects(() =>
      actions.replyAction(id, {}, form({ body: "x" })),
    );
  }
  await assert.rejects(() =>
    actions.replyAction(1, {}, form({ body: "x", attachmentIds: ["../2"] })),
  );
  await assert.rejects(() =>
    actions.splitThreadAction(
      1,
      {},
      form({ postIds: ["1", "x"], nodeId: "2", title: "t" }),
    ),
  );
  await assert.rejects(() =>
    actions.moveThreadAction(1, {}, form({ nodeId: "0x10" })),
  );
  assert.equal(asked.length, 0);
});
