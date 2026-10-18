import { afterEach, beforeEach, mock, test } from "bun:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
const asked: { method: string; url: string; body: unknown }[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: {} };
let refreshed = 0;

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ refresh: () => refreshed++ }));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const actions = await import("./polls-actions");

const ROOT = "http://127.0.0.1:8787/api/v1";
const REFUSAL = {
  status: 403,
  body: { error: { code: "forbidden", message: "Not for you." } },
};

const poll = {
  id: 5,
  threadId: 9,
  kind: "poll",
  anonymous: false,
  maxChoices: 1,
  allowCustom: false,
  allowChange: true,
  results: "always",
  closesAt: null,
  closed: false,
  answerMaxLength: 100,
  resultsShown: true,
  voterCount: 1,
  questions: [
    {
      id: 1,
      text: "Q?",
      image: null,
      explanation: null,
      answered: true,
      answers: [
        {
          id: 11,
          text: "A",
          image: null,
          votes: 1,
          chosen: true,
          correct: null,
          custom: false,
        },
        {
          id: 12,
          text: "B",
          image: null,
          votes: 0,
          chosen: false,
          correct: null,
          custom: false,
        },
      ],
    },
  ],
  mine: { voted: true, answered: 1, correct: 0, completed: true },
  permissions: {
    canVote: true,
    canAddAnswer: false,
    canEdit: false,
    canDelete: false,
    canClose: false,
    canViewVoters: false,
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

beforeEach(() => {
  asked.length = 0;
  refreshed = 0;
  answer = { status: 200, body: poll };
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

test("a vote names the poll, the question and the answers, and answers with the poll as it is now", async () => {
  const done = await actions.pollVoteAction(9, 5, 1, [11]);
  assert.equal(asked[0].method, "POST");
  assert.equal(asked[0].url, `${ROOT}/polls/5/vote`);
  assert.deepEqual(asked[0].body, { questionId: 1, answerIds: [11] });
  assert.ok("poll" in done);
});

test("a refusal comes back as the backend's message, nothing else", async () => {
  answer = REFUSAL;
  assert.deepEqual(await actions.pollVoteAction(9, 5, 1, [11]), {
    error: "Not for you.",
  });
  assert.deepEqual(await actions.pollAddAnswerAction(9, 5, "Mine"), {
    error: "Not for you.",
  });
  assert.deepEqual(await actions.pollCloseAction(9, 5, true), {
    error: "Not for you.",
  });
  assert.deepEqual(await actions.pollSaveAction(9, 5, '{"questions":[]}'), {
    error: "Not for you.",
  });
  assert.deepEqual(await actions.pollVotersAction(9, 5, 11, null), {
    error: "Not for you.",
  });
  assert.deepEqual(await actions.pollDefinitionAction(9, 5), {
    error: "Not for you.",
  });
  assert.equal(refreshed, 0);
});

test("ids that are not ids never reach the backend", async () => {
  await assert.rejects(() => actions.pollVoteAction(9, 0, 1, [11]));
  await assert.rejects(() => actions.pollVoteAction(9, 5, 1, [1.5]));
  await assert.rejects(() => actions.pollCloseAction(-1, 5, true));
  assert.equal(asked.length, 0);
});

test("adding an answer and closing or reopening are one call each", async () => {
  await actions.pollAddAnswerAction(9, 5, "Mine");
  assert.equal(asked[0].url, `${ROOT}/polls/5/answers`);
  assert.deepEqual(asked[0].body, { text: "Mine" });
  await actions.pollCloseAction(9, 5, true);
  assert.equal(asked[1].method, "PUT");
  assert.equal(asked[1].url, `${ROOT}/polls/5/closed`);
  assert.deepEqual(asked[1].body, { closed: true });
  assert.equal(refreshed, 1);
});

test("a new poll is created on its thread; an edited one is updated without its kind or anonymity", async () => {
  const json = JSON.stringify({
    kind: "quiz",
    anonymous: true,
    maxChoices: 1,
    questions: [{ text: "Q?", answers: [{ text: "A" }, { text: "B" }] }],
  });
  await actions.pollSaveAction(9, null, json);
  assert.equal(asked[0].method, "POST");
  assert.equal(asked[0].url, `${ROOT}/threads/9/poll`);
  assert.equal((asked[0].body as { poll: { kind: string } }).poll.kind, "quiz");
  await actions.pollSaveAction(9, 5, json);
  assert.equal(asked[1].method, "PATCH");
  assert.equal(asked[1].url, `${ROOT}/polls/5`);
  const sent = (asked[1].body as { poll: Record<string, unknown> }).poll;
  assert.equal("kind" in sent, false);
  assert.equal("anonymous" in sent, false);
  assert.equal(refreshed, 2);
  // Not a poll at all: nothing is asked.
  asked.length = 0;
  assert.deepEqual(await actions.pollSaveAction(9, null, "oops"), {
    error: "invalid",
  });
  assert.equal(asked.length, 0);
});

test("the voters of an answer come a page at a time, as members", async () => {
  answer = {
    status: 200,
    body: {
      items: [
        {
          user: { id: 3, username: "bob" },
          votedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      nextCursor: "next",
    },
  };
  const done = await actions.pollVotersAction(9, 5, 11, "c1");
  assert.equal(asked[0].method, "GET");
  assert.match(asked[0].url, /\/polls\/5\/answers\/11\/voters\?/);
  assert.match(asked[0].url, /cursor=c1/);
  assert.deepEqual(done, {
    items: [{ id: 3, username: "bob" }],
    nextCursor: "next",
  });
});

test("deleting a poll sends the reason and redraws the page", async () => {
  answer = { status: 200, body: { ok: true, completed: true } };
  const data = new FormData();
  data.append("reason", "Spam");
  assert.deepEqual(await actions.pollDeleteAction(9, 5, {}, data), {
    done: true,
  });
  assert.equal(asked[0].method, "DELETE");
  assert.equal(asked[0].url, `${ROOT}/polls/5`);
  assert.deepEqual(asked[0].body, { reason: "Spam" });
  assert.equal(refreshed, 1);
});

test("a poll with very many voters is deleted with one call: the backend's job does the rest", async () => {
  answer = { status: 200, body: { ok: true, completed: false } };
  assert.deepEqual(await actions.pollDeleteAction(9, 5, {}, new FormData()), {
    done: true,
  });
  assert.equal(asked.length, 1);
  assert.equal(refreshed, 1);
});

test("the poll comes back to the client without picture addresses", async () => {
  const picture = {
    fileId: 70,
    url: "/api/v1/files/70",
    contentType: "image/png",
    byteSize: 1,
    width: 1,
    height: 1,
    filename: null,
    thumbnailUrl: "/api/v1/files/71",
    widths: [],
  };
  answer = {
    status: 200,
    body: {
      ...poll,
      questions: [
        {
          ...poll.questions[0],
          image: picture,
          answers: [
            { ...poll.questions[0].answers[0], image: picture },
            poll.questions[0].answers[1],
          ],
        },
      ],
    },
  };
  const done = await actions.pollVoteAction(9, 5, 1, [11]);
  assert.ok("poll" in done);
  const text = JSON.stringify(done);
  assert.ok(text.includes('"fileId":70'));
  assert.ok(!text.includes("/files/") && !text.includes("thumbnail"));
});

test("an editor started from an older definition is told so, and the version travels with the save", async () => {
  answer = {
    status: 409,
    body: {
      error: {
        code: "conflict",
        message: "Changed.",
        issues: [{ path: ["loadedAt"], message: "stale" }],
      },
    },
  };
  const json = JSON.stringify({
    questions: [{ text: "Q?", answers: [{ text: "A" }, { text: "B" }] }],
  });
  assert.deepEqual(
    await actions.pollSaveAction(9, 5, json, "2026-01-01T00:00:00.000Z"),
    { error: "Changed.", conflict: true },
  );
  assert.equal(
    (asked[0].body as { loadedAt: string }).loadedAt,
    "2026-01-01T00:00:00.000Z",
  );
  answer = REFUSAL;
  assert.deepEqual(await actions.pollSaveAction(9, 5, json), {
    error: "Not for you.",
  });
});

test("any other conflict is shown as it is, not as a stale editor", async () => {
  answer = {
    status: 409,
    body: {
      error: {
        code: "conflict",
        message: "This answer has too many votes to remove in one step.",
      },
    },
  };
  const json = JSON.stringify({
    questions: [{ text: "Q?", answers: [{ text: "A" }, { text: "B" }] }],
  });
  assert.deepEqual(
    await actions.pollSaveAction(9, 5, json, "2026-01-01T00:00:00.000Z"),
    {
      error: "This answer has too many votes to remove in one step.",
    },
  );
});
