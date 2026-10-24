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

test("a comment carries the files that were attached to it", async () => {
  await commentOnWallPost(
    8,
    5,
    {},
    form({ body: "hi", attachmentIds: ["4", "5"] }),
  );
  assert.deepEqual(asked[0].body, { body: "hi", attachmentIds: [4, 5] });
});

test("a comment's attachment id that is not a record id never reaches the backend", async () => {
  await assert.rejects(() =>
    commentOnWallPost(8, 5, {}, form({ body: "hi", attachmentIds: "x" })),
  );
  assert.equal(asked.length, 0);
});

// The wall composer keeps what was written by not letting React reset its form, so what empties
// and closes it is the redirect alone: Next draws the page's forms anew when an action ends in
// one. A refusal must therefore come back as a state, and a post that was taken must redirect.
const WALL_POST = {
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
  canReport: true,
  canComment: true,
  deletion: null,
};

test("a wall post that was taken ends in a redirect to the page it was written on, on the wall at the post", async () => {
  globalThis.fetch = (async () =>
    Response.json(WALL_POST)) as unknown as typeof fetch;
  for (const [page, to] of [
    ["/", "/"],
    ["/members/5", "/members/5?post=9#profile-post-9"],
    ["/members/5?cursor=abc", "/members/5?post=9#profile-post-9"],
    ["/members/51", "/members/51"],
  ]) {
    const digest = await postToWall(5, page, {}, form({ body: "hi" })).then(
      () => undefined,
      (error: { digest?: unknown }) => String(error.digest),
    );
    assert.equal(digest?.split(";")[0], "NEXT_REDIRECT");
    assert.equal(digest?.split(";")[2], to);
  }
});

// The browser shows the wall at the profile's slugged address. Going to the plain one would be a
// navigation to another route (its placeholder over the whole page), which the proxy sends on to
// the slugged address again: the wall at the post keeps the address the browser is at.
test("a wall post written on the wall goes to the post at the wall's own slugged address", async () => {
  globalThis.fetch = (async () =>
    Response.json(WALL_POST)) as unknown as typeof fetch;
  for (const [referer, to] of [
    ["/members/5-ember?tab=wall", "/members/5-ember?post=9#profile-post-9"],
    ["/members/5-ember", "/members/5-ember?post=9#profile-post-9"],
    // Another member's page is not this wall: its plain address.
    ["/members/51-wren", "/members/5?post=9#profile-post-9"],
  ]) {
    incoming = new Headers({
      referer: `http://localhost:3105${referer}`,
      host: "localhost:3105",
    });
    const digest = await postToWall(
      5,
      "/members/5",
      {},
      form({ body: "hi" }),
    ).then(
      () => undefined,
      (error: { digest?: unknown }) => String(error.digest),
    );
    assert.equal(digest?.split(";")[2], to, referer);
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

const COMMENT = {
  id: 12,
  profilePostId: 8,
  author: { id: 3, username: "ember" },
  state: "visible",
  createdAt: "2026-10-13T03:57:31.497Z",
  editedAt: null,
  bodyHtml: "<p>hi</p>",
  attachmentCount: 0,
  attachments: [],
  bodySource: "hi",
  reactions: { counts: {}, total: 0, mine: null },
  canEdit: true,
  canDelete: true,
  canHardDelete: false,
  canReport: true,
  deletion: null,
};

// On the wall, as in the feed, the page stays where it is: drawn again with the new comment, which
// the composer lands on. Opening the wall's address at the comment would put the route's
// placeholder over the whole page.
test("a comment written on a wall draws the page again and names the comment to land on", async () => {
  globalThis.fetch = (async () =>
    Response.json(COMMENT)) as unknown as typeof fetch;
  const state = await commentOnWallPost(8, 5, {}, form({ body: "hi" }));
  assert.deepEqual(state, { landOn: "#profile-comment-12" });
  assert.equal(refreshed, 1);
});

test("a refused comment answers its form and refreshes nothing", async () => {
  const state = await commentOnWallPost(8, undefined, {}, form({ body: "" }));
  assert.deepEqual(state, { error: "No." });
  assert.equal(refreshed, 0);
});

// The feed stays where it is: drawn again with the new comment, which the composer lands on. A
// redirect to the feed's own address would differ from the browser's by its hash alone, which the
// router answers by scrolling to the top.
test("a comment written in the feed draws the page again and names the comment to land on", async () => {
  incoming = new Headers({
    referer: "http://localhost:3105/?tab=top&pages=3",
    host: "localhost:3105",
  });
  globalThis.fetch = (async () =>
    Response.json(COMMENT)) as unknown as typeof fetch;
  const state = await commentOnWallPost(8, undefined, {}, form({ body: "hi" }));
  assert.deepEqual(state, { landOn: "#profile-comment-12" });
  assert.equal(refreshed, 1);
});
