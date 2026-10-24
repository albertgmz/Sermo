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
  editConversationAction,
  leaveAction,
  markRead,
  markReadAction,
  markUnreadAction,
  quoteMessageSource,
  replyAction,
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
        lastMessage: {
          messageId: 3,
          sentAt: stamp,
          user: { kind: "member", ...user },
        },
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
        author: { kind: "member", ...user },
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
    author: { kind: "member", ...user },
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
  // Page 1 is the oldest messages: the member lands on their reply, on the page that holds it.
  assert.match(
    digest ?? "",
    /^NEXT_REDIRECT;[a-z]+;\/conversations\/3\?message=9#message-9;/,
  );
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
  lastMessage: {
    messageId: 3,
    sentAt: stamp,
    user: { kind: "member", ...ember },
  },
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

// What the Edit dialog sends: the title and the lock as they are now, and as the dialog opened
// with them; one it does not offer is not sent.
const edit = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
};

function recordSends() {
  const sent: [string, string, unknown][] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push([init.method ?? "GET", url, JSON.parse(String(init.body))]);
    return Response.json(conversationAnswer);
  }) as unknown as typeof fetch;
  return sent;
}

test("the edit dialog saves a new title, stays on the page and draws it and the list again", async () => {
  const sent = recordSends();
  const form = edit({ title: "New name", titleWas: "T", lockedWas: "" });
  assert.deepEqual(await editConversationAction(3, {}, form), { done: true });
  assert.deepEqual(sent, [
    [
      "PATCH",
      "http://127.0.0.1:8787/api/v1/conversations/3",
      { title: "New name" },
    ],
  ]);
  assert.deepEqual(revalidated, [["/[locale]/conversations", "layout"]]);
});

test("the edit dialog locks and unlocks when its box changed, and leaves an unchanged title alone", async () => {
  const sent = recordSends();
  const locking = edit({
    title: "T",
    titleWas: "T",
    locked: "1",
    lockedWas: "",
  });
  assert.deepEqual(await editConversationAction(3, {}, locking), {
    done: true,
  });
  const unlocking = edit({ lockedWas: "1" });
  assert.deepEqual(await editConversationAction(3, {}, unlocking), {
    done: true,
  });
  assert.deepEqual(sent, [
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
  ]);
});

test("the edit dialog sends nothing when nothing changed, and nothing it does not offer", async () => {
  const sent = recordSends();
  // A starter who may not lock: the box is not in the form.
  assert.deepEqual(
    await editConversationAction(3, {}, edit({ title: "T", titleWas: "T" })),
    { done: true },
  );
  // A moderator who may not rename: the title is not in the form.
  assert.deepEqual(
    await editConversationAction(3, {}, edit({ lockedWas: "" })),
    { done: true },
  );
  assert.deepEqual(sent, []);
  assert.deepEqual(revalidated, []);
});

test("a refused edit shows the backend's reason; a title saved before a refused lock is drawn", async () => {
  globalThis.fetch = (async () => refusal.clone()) as unknown as typeof fetch;
  const renaming = edit({ title: "New name", titleWas: "T", lockedWas: "" });
  assert.deepEqual(await editConversationAction(3, {}, renaming), {
    error: "Only the starter may do that.",
  });
  assert.deepEqual(revalidated, []);
  globalThis.fetch = (async (_url: string, init: RequestInit) =>
    init.method === "PATCH"
      ? Response.json(conversationAnswer)
      : refusal.clone()) as unknown as typeof fetch;
  const both = edit({
    title: "New",
    titleWas: "T",
    locked: "1",
    lockedWas: "",
  });
  assert.deepEqual(await editConversationAction(3, {}, both), {
    error: "Only the starter may do that.",
  });
  assert.deepEqual(revalidated, [["/[locale]/conversations", "layout"]]);
  await assert.rejects(() => editConversationAction(-1, {}, renaming));
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

test("a message is quoted from the source the backend gives a participant, and a refusal quotes nothing", async () => {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({ method: init.method ?? "GET", url });
    return Response.json({
      messageId: 11,
      author: { kind: "member", id: 3, username: "ember" },
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
