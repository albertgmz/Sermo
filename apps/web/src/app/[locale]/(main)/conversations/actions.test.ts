import { afterEach, beforeEach, mock, test } from "bun:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
const asked: { method: string; url: string; body?: unknown }[] = [];

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
  markUnreadAction,
  quoteMessageSource,
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
    asked.push({
      method: init.method ?? "GET",
      url,
      body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
    });
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

const choice = (futureMessages?: string) => {
  const form = new FormData();
  if (futureMessages !== undefined) form.set("futureMessages", futureMessages);
  return form;
};

test("leaving a conversation asks the backend about that conversation and goes to the list", async () => {
  const digest = await redirectedTo(() => leaveAction(7, {}, choice("accept")));
  assert.match(digest ?? "", /^NEXT_REDIRECT;[a-z]+;\/conversations;/);
  assert.deepEqual(asked, [
    {
      method: "POST",
      url: "http://127.0.0.1:8787/api/v1/conversations/7/leave",
      body: { futureMessages: "accept" },
    },
  ]);
});

test("leaving sends the choice about future messages: ignore only when it is asked for", async () => {
  await redirectedTo(() => leaveAction(7, {}, choice("ignore")));
  await redirectedTo(() => leaveAction(7, {}, choice()));
  await redirectedTo(() => leaveAction(7, {}, choice("something else")));
  assert.deepEqual(
    asked.map((request) => request.body),
    [
      { futureMessages: "ignore" },
      { futureMessages: "accept" },
      { futureMessages: "accept" },
    ],
  );
});

test("marking unread asks the backend about that conversation, refreshes the frame and goes to the list", async () => {
  const digest = await redirectedTo(() => markUnreadAction(7, {}));
  assert.match(digest ?? "", /^NEXT_REDIRECT;[a-z]+;\/conversations;/);
  assert.deepEqual(asked, [
    {
      method: "DELETE",
      url: "http://127.0.0.1:8787/api/v1/conversations/7/read",
      body: undefined,
    },
  ]);
  assert.deepEqual(revalidated, [["/[locale]/conversations", "layout"]]);
  await assert.rejects(() => markUnreadAction(0, {}));
});

test("a conversation id that is not a record id never becomes a path", async () => {
  for (const id of [".." as unknown as number, 0, -3, Number.NaN]) {
    await assert.rejects(() => leaveAction(id, {}, choice()));
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
        canHardDelete: false,
        canReport: true,
        deletion: null,
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
    canHardDelete: false,
    canReport: true,
    deletion: null,
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

test("a message is quoted from the source the backend gives a participant, and a refusal quotes nothing", async () => {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({ method: init.method ?? "GET", url });
    return Response.json({
      messageId: 11,
      author: { id: 3, username: "ember" },
      bodySource: "[B]hi[/B]",
    });
  }) as unknown as typeof fetch;
  assert.deepEqual(await quoteMessageSource(11), {
    author: "ember",
    authorId: 3,
    source: "[B]hi[/B]",
  });
  assert.deepEqual(asked, [
    {
      method: "GET",
      url: "http://127.0.0.1:8787/api/v1/conversation-messages/11/quote",
    },
  ]);
  globalThis.fetch = (async () =>
    Response.json(
      { error: { code: "not_found", message: "Not found." } },
      { status: 404 },
    )) as unknown as typeof fetch;
  assert.equal(await quoteMessageSource(11), null);
  await assert.rejects(() => quoteMessageSource(".." as unknown as number));
});
