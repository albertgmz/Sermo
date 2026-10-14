import { afterEach, beforeEach, mock, test } from "bun:test";
import assert from "node:assert/strict";
import { profileCommentBody, profilePostBody } from "@/lib/test-bodies";

const realFetch = globalThis.fetch;
type Asked = { method: string; url: string; body: unknown };
const asked: Asked[] = [];
let answer: Response;

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
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

const { deleteWallItem, editWallItem, wallItemSource } = await import(
  "./actions"
);
const { reportContent } = await import("../actions");
const { deleteMessageAction, editMessageAction } = await import(
  "../conversations/actions"
);

const refusal = () =>
  Response.json(
    { error: { code: "forbidden", message: "You may not do that." } },
    { status: 403 },
  );

beforeEach(() => {
  asked.length = 0;
  refreshed = 0;
  answer = Response.json({});
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({
      method: init.method ?? "GET",
      url,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    return answer.clone();
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const form = (fields: Record<string, string> = {}) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const ROOT = "http://127.0.0.1:8787/api/v1";

test("editing a wall post sends its text and leaves its files alone, then refreshes the page", async () => {
  answer = Response.json(
    profilePostBody({ editedAt: "2026-01-02T00:00:00.000Z" }),
  );
  assert.deepEqual(await editWallItem("post", 12, {}, form({ body: "new" })), {
    done: true,
  });
  assert.deepEqual(asked, [
    { method: "PATCH", url: `${ROOT}/profile-posts/12`, body: { body: "new" } },
  ]);
  assert.equal(refreshed, 1);
});

test("editing a comment goes to the comment's own address", async () => {
  answer = Response.json(profileCommentBody());
  await editWallItem("comment", 44, {}, form({ body: "new" }));
  assert.deepEqual(asked, [
    {
      method: "PATCH",
      url: `${ROOT}/profile-comments/44`,
      body: { body: "new" },
    },
  ]);
});

test("a refused edit or delete is what the form shows, and the page is not refreshed", async () => {
  answer = refusal();
  const shown = { error: "You may not do that." };
  assert.deepEqual(
    await editWallItem("post", 12, {}, form({ body: "x" })),
    shown,
  );
  assert.deepEqual(await deleteWallItem("comment", 44, {}, form()), shown);
  assert.equal(refreshed, 0);
});

test("deleting a wall post or a comment names the right record and refreshes", async () => {
  answer = Response.json(profilePostBody({ state: "deleted" }));
  assert.deepEqual(
    await deleteWallItem("post", 12, {}, form({ reason: "spam" })),
    {},
  );
  answer = Response.json(profileCommentBody({ state: "deleted" }));
  assert.deepEqual(await deleteWallItem("comment", 44, {}, form()), {});
  assert.deepEqual(
    asked.map(({ method, url }) => [method, new URL(url).pathname]),
    [
      ["DELETE", "/api/v1/profile-posts/12"],
      ["DELETE", "/api/v1/profile-comments/44"],
    ],
  );
  assert.equal(refreshed, 2);
});

test("the source for editing comes from the record, and a refusal gives none", async () => {
  answer = Response.json(profilePostBody({ bodySource: "**hi**" }));
  assert.equal(await wallItemSource("post", 12), "**hi**");
  answer = Response.json(profileCommentBody({ bodySource: "yo" }));
  assert.equal(await wallItemSource("comment", 44), "yo");
  answer = refusal();
  assert.equal(await wallItemSource("post", 12), null);
});

test("a kind or an id that is not a wall record never reaches the backend", async () => {
  const wrong = "thread" as unknown as "post";
  assert.deepEqual(await editWallItem(wrong, 12, {}, form({ body: "x" })), {});
  assert.deepEqual(await deleteWallItem(wrong, 12, {}, form()), {});
  assert.equal(await wallItemSource(wrong, 12), null);
  for (const id of [".." as unknown as number, 0, -3, Number.NaN]) {
    await assert.rejects(() =>
      editWallItem("post", id, {}, form({ body: "x" })),
    );
    await assert.rejects(() => deleteWallItem("post", id, {}, form()));
    await assert.rejects(() => wallItemSource("comment", id));
  }
  assert.equal(asked.length, 0);
});

test("a report names the kind of content under its backend name and confirms once taken", async () => {
  answer = Response.json({ id: 1, groupId: 1 });
  for (const type of [
    "post",
    "profile_post",
    "profile_post_comment",
    "conversation_message",
  ] as const) {
    asked.length = 0;
    assert.deepEqual(
      await reportContent(type, 31, {}, form({ reason: "spam" })),
      { done: true },
    );
    assert.deepEqual(asked[0].body, {
      target: { type, id: 31 },
      reason: "spam",
    });
  }
});

test("a refused report shows the reason, and a made-up kind or a bad id goes nowhere", async () => {
  answer = refusal();
  assert.deepEqual(
    await reportContent("post", 31, {}, form({ reason: "spam" })),
    { error: "You may not do that." },
  );
  asked.length = 0;
  assert.deepEqual(
    await reportContent(
      "user" as unknown as "post",
      31,
      {},
      form({ reason: "x" }),
    ),
    {},
  );
  await assert.rejects(() =>
    reportContent("post", 0, {}, form({ reason: "x" })),
  );
  assert.equal(asked.length, 0);
});

test("deleting a conversation message asks for that message and refreshes the page", async () => {
  answer = Response.json({ ok: true });
  assert.deepEqual(await deleteMessageAction(5, 11, {}), {});
  assert.deepEqual(
    asked.map(({ method, url }) => [method, url]),
    [["DELETE", `${ROOT}/conversation-messages/11`]],
  );
  assert.equal(refreshed, 1);
  answer = refusal();
  assert.deepEqual(await deleteMessageAction(5, 11, {}), {
    error: "You may not do that.",
  });
  assert.equal(refreshed, 1);
  await assert.rejects(() => deleteMessageAction(5, 0, {}));
});

test("editing a message sends its text, leaves its files alone and returns to it", async () => {
  answer = Response.json({
    id: 11,
    conversationId: 5,
    author: { id: 3, username: "ember" },
    state: "visible",
    createdAt: "2026-01-01T00:00:00.000Z",
    editedAt: "2026-01-02T00:00:00.000Z",
    bodyHtml: "",
    attachmentCount: 0,
    attachments: [],
    reactions: { counts: {}, total: 0, mine: null },
    canEdit: true,
    canDelete: false,
  });
  const digest = await editMessageAction(5, 11, {}, form({ body: "new" })).then(
    () => "",
    (error: { digest?: unknown }) => String(error.digest),
  );
  assert.match(digest, /;\/conversations\/5\?message=11#message-11;/);
  assert.deepEqual(asked, [
    {
      method: "PATCH",
      url: `${ROOT}/conversation-messages/11`,
      body: { body: "new" },
    },
  ]);
});
