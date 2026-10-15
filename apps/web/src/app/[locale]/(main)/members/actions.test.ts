import { afterEach, beforeEach, mock, test } from "bun:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
const asked: { url: string; body: unknown }[] = [];

mock.module("server-only", () => ({}));
let incoming = new Headers();
mock.module("next/headers", () => ({
  headers: async () => incoming,
  cookies: async () => ({ set: () => {} }),
}));
let refreshed = 0;
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  revalidatePath: () => {},
  refresh: () => {
    refreshed += 1;
  },
}));

const { commentOnWallPost, postToWall } = await import("./actions");

beforeEach(() => {
  incoming = new Headers();
  asked.length = 0;
  refreshed = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({ url, body: JSON.parse(String(init.body)) });
    // A refusal: the action answers with it instead of a redirect, which is enough to see what
    // was asked.
    return Response.json(
      { error: { code: "forbidden", message: "No." } },
      { status: 403 },
    );
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

// The wall composer keeps what was written by not letting React reset its form, so what empties
// and closes it is the redirect alone: Next draws the page's forms anew when an action ends in
// one. A refusal must therefore come back as a state, and a post that was taken must redirect.
test("a wall post that was taken ends in a redirect to the page it was written on", async () => {
  globalThis.fetch = (async () =>
    Response.json({
      id: 9,
      profileUserId: 5,
      author: { id: 3, username: "ember" },
      state: "visible",
      createdAt: "2026-10-13T03:57:31.497Z",
      editedAt: null,
      bodyHtml: "<p>hi</p>",
      bodySource: "hi",
      attachmentCount: 0,
      attachments: [],
      reactions: { counts: {}, total: 0, mine: null },
      commentCount: 0,
      latestComments: [],
      canEdit: true,
      canDelete: true,
      canComment: true,
    })) as unknown as typeof fetch;
  for (const page of ["/", "/members/5"]) {
    const digest = await postToWall(5, page, {}, form({ body: "hi" })).then(
      () => undefined,
      (error: { digest?: unknown }) => String(error.digest),
    );
    assert.equal(digest?.split(";")[0], "NEXT_REDIRECT");
    assert.equal(digest?.split(";")[2], page);
  }
});

test("a refused wall post answers the form it came from and goes nowhere", async () => {
  globalThis.fetch = (async () =>
    Response.json(
      { error: { code: "validation", message: "Write something first." } },
      { status: 422 },
    )) as unknown as typeof fetch;
  const state = await postToWall(
    5,
    "/",
    {},
    form({ body: "", attachmentIds: ["4"] }),
  );
  assert.deepEqual(state, { error: "Write something first." });
});

// The comment count leads to the composer by a hash, and an address that differs from the
// browser's by its hash alone is not asked of the server again: without the refresh the new
// comment is saved and not shown.
test("a comment that was taken refreshes the page and returns to the wall or the feed it was written on", async () => {
  for (const page of ["/members/5", "/?tab=following&cursor=abc"]) {
    refreshed = 0;
    globalThis.fetch = (async () =>
      Response.json({
        id: 12,
        profilePostId: 8,
        author: { id: 3, username: "ember" },
        state: "visible",
        createdAt: "2026-10-13T03:57:31.497Z",
        editedAt: null,
        bodyHtml: "<p>hi</p>",
        bodySource: "hi",
        reactions: { counts: {}, total: 0, mine: null },
        canEdit: true,
        canDelete: true,
      })) as unknown as typeof fetch;
    const digest = await commentOnWallPost(
      8,
      page,
      {},
      form({ body: "hi" }),
    ).then(
      () => undefined,
      (error: { digest?: unknown }) => String(error.digest),
    );
    assert.equal(digest?.split(";")[0], "NEXT_REDIRECT");
    assert.equal(digest?.split(";")[2], page);
    assert.equal(refreshed, 1);
  }
});

test("a refused comment answers its form and refreshes nothing", async () => {
  const state = await commentOnWallPost(8, "/", {}, form({ body: "" }));
  assert.deepEqual(state, { error: "No." });
  assert.equal(refreshed, 0);
});

// The feed has no address of its own to give: a comment written on a card there returns to the
// address the browser has, the number of pages loaded included.
test("a comment written in the feed returns to the feed address the browser has", async () => {
  incoming = new Headers({
    referer: "http://localhost:3105/?tab=top&pages=3",
    host: "localhost:3105",
  });
  globalThis.fetch = (async () =>
    Response.json({
      id: 12,
      profilePostId: 8,
      author: { id: 3, username: "ember" },
      state: "visible",
      createdAt: "2026-10-13T03:57:31.497Z",
      editedAt: null,
      bodyHtml: "<p>hi</p>",
      bodySource: "hi",
      reactions: { counts: {}, total: 0, mine: null },
      canEdit: true,
      canDelete: true,
    })) as unknown as typeof fetch;
  const digest = await commentOnWallPost(
    8,
    undefined,
    {},
    form({ body: "hi" }),
  ).then(
    () => undefined,
    (error: { digest?: unknown }) => String(error.digest),
  );
  assert.equal(digest?.split(";")[0], "NEXT_REDIRECT");
  assert.equal(digest?.split(";")[2], "/?tab=top&pages=3");
});
