import { afterEach, beforeEach, mock, test } from "bun:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
const asked: { method: string; url: string }[] = [];

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const revalidated: unknown[][] = [];
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({
  ...nextCache,
  revalidatePath: (...args: unknown[]) => revalidated.push(args),
}));

const {
  addParticipantsAction,
  leaveAction,
  markRead,
  markReadAction,
  renameAction,
  replyAction,
  setLockedAction,
  startConversation,
} = await import("./actions");
const { markOneRead } = await import("../notifications/actions");

beforeEach(() => {
  asked.length = 0;
  revalidated.length = 0;
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

test("starting a conversation refreshes the list in the layout before going to the new page", async () => {
  const user = { id: 3, username: "ember" };
  const stamp = "2026-10-13T03:57:31.497Z";
  globalThis.fetch = (async () =>
    Response.json({
      conversation: {
        id: 3,
        title: "T",
        starter: user,
        createdAt: stamp,
        lastMessage: { messageId: 3, sentAt: stamp, user },
        messageCount: 1,
        participantCount: 2,
        isUnread: false,
        participants: [{ user, state: "active" }],
        canReply: true,
        canInvite: true,
        canRename: true,
        isLocked: false,
        canLock: true,
      },
      message: {
        id: 3,
        conversationId: 3,
        author: user,
        state: "visible",
        createdAt: stamp,
        bodyHtml: "<p>hi</p>",
        editedAt: null,
        attachmentCount: 0,
        attachments: [],
        reactions: { counts: {}, total: 0, mine: null },
        canEdit: true,
        canDelete: false,
      },
    })) as unknown as typeof fetch;
  const form = new FormData();
  form.set("title", "T");
  form.set("body", "hi");
  form.append("recipientIds", "4");
  const digest = await redirectedTo(() => startConversation({}, form));
  assert.match(digest ?? "", /^NEXT_REDIRECT;[a-z]+;\/conversations\/3;/);
  assert.deepEqual(revalidated, [["/[locale]/conversations", "layout"]]);
});

test("a reply and a new conversation name the files attached to them", async () => {
  const user = { id: 3, username: "ember" };
  const stamp = "2026-10-13T03:57:31.497Z";
  const message = {
    id: 9,
    conversationId: 3,
    author: user,
    state: "visible",
    createdAt: stamp,
    bodyHtml: "<p>hi</p>",
    editedAt: null,
    attachmentCount: 2,
    attachments: [],
    reactions: { counts: {}, total: 0, mine: null },
    canEdit: true,
    canDelete: true,
  };
  const sent: unknown[] = [];
  // A reply is answered with the message; the conversation is refused, which is enough to see
  // what was asked.
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return url.endsWith("/messages")
      ? Response.json(message)
      : Response.json(
          { error: { code: "forbidden", message: "No." } },
          { status: 403 },
        );
  }) as unknown as typeof fetch;

  const reply = new FormData();
  reply.set("body", "hi");
  reply.append("attachmentIds", "4");
  reply.append("attachmentIds", "5");
  const digest = await redirectedTo(() => replyAction(3, {}, reply));
  assert.match(digest ?? "", /^NEXT_REDIRECT;[a-z]+;\/conversations\/3;/);
  assert.deepEqual(sent, [{ body: "hi", attachmentIds: [4, 5] }]);

  const start = new FormData();
  start.set("title", "T");
  start.set("body", "hi");
  start.append("recipientIds", "4");
  start.append("attachmentIds", "6");
  await startConversation({}, start);
  assert.deepEqual(sent[1], {
    title: "T",
    recipientIds: [4],
    body: "hi",
    attachmentIds: [6],
  });

  // An id that is not one never reaches the backend.
  reply.append("attachmentIds", "../7");
  await assert.rejects(() => replyAction(3, {}, reply));
  assert.equal(sent.length, 2);
});

const ember = { id: 3, username: "ember" };
const stamp = "2026-10-13T03:57:31.497Z";
const conversationAnswer = {
  id: 3,
  title: "T",
  starter: ember,
  createdAt: stamp,
  lastMessage: { messageId: 3, sentAt: stamp, user: ember },
  messageCount: 1,
  participantCount: 2,
  isUnread: false,
  participants: [{ user: ember, state: "active" }],
  canReply: true,
  canInvite: true,
  canRename: true,
  isLocked: false,
  canLock: true,
};
const refusal = Response.json(
  { error: { code: "forbidden", message: "Only the starter may do that." } },
  { status: 403 },
);

test("adding people sends the picked members, refreshes the list and returns to the conversation", async () => {
  const sent: { method: string; url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      method: init.method ?? "GET",
      url,
      body: JSON.parse(String(init.body)),
    });
    return Response.json(conversationAnswer);
  }) as unknown as typeof fetch;
  const form = new FormData();
  form.append("recipientIds", "4");
  form.append("recipientIds", "5");
  const digest = await redirectedTo(() => addParticipantsAction(3, {}, form));
  assert.match(digest ?? "", /^NEXT_REDIRECT;[a-z]+;\/conversations\/3;/);
  assert.deepEqual(sent, [
    {
      method: "POST",
      url: "http://127.0.0.1:8787/api/v1/conversations/3/participants",
      body: { userIds: [4, 5] },
    },
  ]);
  assert.deepEqual(revalidated, [["/[locale]/conversations", "layout"]]);
});

test("a refused addition shows the backend's reason and does not leave the page", async () => {
  globalThis.fetch = (async () => refusal.clone()) as unknown as typeof fetch;
  const form = new FormData();
  form.append("recipientIds", "4");
  // A refusal comes back as the form's state; no redirect is thrown.
  const state = await addParticipantsAction(3, {}, form);
  assert.deepEqual(state, { error: "Only the starter may do that." });
  assert.deepEqual(revalidated, []);
});

test("an id that is not a member id never reaches the backend when people are added", async () => {
  const form = new FormData();
  form.append("recipientIds", "../4");
  await assert.rejects(() => addParticipantsAction(3, {}, form));
  await assert.rejects(() => addParticipantsAction(0, {}, new FormData()));
  assert.equal(asked.length, 0);
});

test("renaming sends the new title and returns to the conversation", async () => {
  const sent: { method: string; url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      method: init.method ?? "GET",
      url,
      body: JSON.parse(String(init.body)),
    });
    return Response.json({ ...conversationAnswer, title: "New name" });
  }) as unknown as typeof fetch;
  const form = new FormData();
  form.set("title", "New name");
  const digest = await redirectedTo(() => renameAction(3, {}, form));
  assert.match(digest ?? "", /^NEXT_REDIRECT;[a-z]+;\/conversations\/3;/);
  assert.deepEqual(sent, [
    {
      method: "PATCH",
      url: "http://127.0.0.1:8787/api/v1/conversations/3",
      body: { title: "New name" },
    },
  ]);
  assert.deepEqual(revalidated, [["/[locale]/conversations", "layout"]]);
});

test("a refused rename shows the backend's reason", async () => {
  globalThis.fetch = (async () => refusal.clone()) as unknown as typeof fetch;
  const form = new FormData();
  form.set("title", "New name");
  assert.deepEqual(await renameAction(3, {}, form), {
    error: "Only the starter may do that.",
  });
  await assert.rejects(() => renameAction(-1, {}, form));
});

test("the page's own mark says whether it worked, and the card's mark says why not", async () => {
  assert.equal(await markRead(3), true);
  assert.deepEqual(await markReadAction(3), {});
  assert.deepEqual(
    asked.map((call) => call.url),
    [
      "http://127.0.0.1:8787/api/v1/conversations/3/read",
      "http://127.0.0.1:8787/api/v1/conversations/3/read",
    ],
  );
  globalThis.fetch = (async () => refusal.clone()) as unknown as typeof fetch;
  assert.equal(await markRead(3), false);
  assert.deepEqual(await markReadAction(3), {
    error: "Only the starter may do that.",
  });
  await assert.rejects(() => markReadAction(0));
});

test("locking and unlocking ask the backend for that state and return to the conversation", async () => {
  const sent: { method: string; url: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({
      method: init.method ?? "GET",
      url,
      body: JSON.parse(String(init.body)),
    });
    return Response.json(conversationAnswer);
  }) as unknown as typeof fetch;
  for (const locked of [true, false]) {
    const digest = await redirectedTo(() => setLockedAction(3, locked, {}));
    assert.match(digest ?? "", /^NEXT_REDIRECT;[a-z]+;\/conversations\/3;/);
  }
  assert.deepEqual(
    sent.map((call) => [call.method, call.url, call.body]),
    [
      [
        "PUT",
        "http://127.0.0.1:8787/api/v1/conversations/3/lock",
        { locked: true },
      ],
      [
        "PUT",
        "http://127.0.0.1:8787/api/v1/conversations/3/lock",
        { locked: false },
      ],
    ],
  );
  globalThis.fetch = (async () => refusal.clone()) as unknown as typeof fetch;
  assert.deepEqual(await setLockedAction(3, true, {}), {
    error: "Only the starter may do that.",
  });
  await assert.rejects(() => setLockedAction(-1, true, {}));
});
