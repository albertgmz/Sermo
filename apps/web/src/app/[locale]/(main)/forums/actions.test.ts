import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
const asked: { method: string; url: string; body: unknown }[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: {} };
// Answers for the requests whose address holds the key, ahead of `answer`.
const answers = new Map<string, { status: number; body: unknown }>();

mock.module("server-only", () => ({}));
let refreshed = 0;
mock.module("next/cache", () => ({
  refresh: () => {
    refreshed += 1;
  },
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async () => (key: string) => key,
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const actions = await import("./actions");

const ROOT = "http://127.0.0.1:8787/api/v1";

beforeEach(() => {
  refreshed = 0;
  asked.length = 0;
  answer = { status: 200, body: {} };
  answers.clear();
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({
      method: init.method ?? "GET",
      url,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const given =
      [...answers].find(([path]) => String(url).includes(path))?.[1] ?? answer;
    return Response.json(given.body, { status: given.status });
  }) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields))
    for (const each of Array.isArray(value) ? value : [value])
      data.append(name, each);
  return data;
};

test("watching a forum from its popover sends the mode and the email choice and draws nothing again", async () => {
  answer = {
    status: 200,
    body: { watching: true, mode: "posts", email: true },
  };
  assert.deepEqual(
    await actions.setForumWatch(4, { mode: "posts", email: true }),
    {},
  );
  assert.equal(asked[0].method, "PUT");
  assert.equal(asked[0].url, `${ROOT}/nodes/4/watch`);
  assert.deepEqual(asked[0].body, { mode: "posts", email: true });
  assert.equal(refreshed, 0);
});

test("an unknown mode watches new threads only", async () => {
  answer = {
    status: 200,
    body: { watching: true, mode: "threads", email: false },
  };
  await actions.setForumWatch(4, {
    mode: "everything" as "threads",
    email: false,
  });
  assert.deepEqual(asked[0].body, { mode: "threads", email: false });
});

test("stopping watching a forum draws nothing again", async () => {
  answer = { status: 200, body: { ok: true } };
  assert.deepEqual(await actions.setForumWatch(4, null), {});
  assert.equal(asked[0].method, "DELETE");
  assert.equal(asked[0].url, `${ROOT}/nodes/4/watch`);
  assert.equal(refreshed, 0);
});

test("the backend's refusal of a watch is what the popover shows", async () => {
  answer = {
    status: 403,
    body: { error: { code: "forbidden", message: "Not for you." } },
  };
  const watched = await actions.setForumWatch(4, {
    mode: "threads",
    email: false,
  });
  assert.equal(watched.error, "Not for you.");
  assert.equal((await actions.setForumWatch(4, null)).error, "Not for you.");
});

test("a visitor whose session ended is told where to sign in", async () => {
  answer = {
    status: 401,
    body: { error: { code: "unauthenticated", message: "Sign in." } },
  };
  const answered = await actions.setForumWatch(4, null);
  assert.equal(
    answered.signIn,
    `/login?next=${encodeURIComponent("/forums/4")}`,
  );
});

test("marking a forum read asks for that forum's marker and stays on the page", async () => {
  answer = {
    status: 200,
    body: { readAt: "2026-01-01T00:00:00.000Z", forums: 2 },
  };
  assert.deepEqual(await actions.markForumReadAction(4, {}), { done: true });
  assert.equal(asked[0].method, "PUT");
  assert.equal(asked[0].url, `${ROOT}/nodes/4/read`);
  await assert.rejects(() => actions.markForumReadAction(-1, {}));
  assert.equal(asked.length, 1);
});

test("marking every forum read asks for the marker of all of them", async () => {
  answer = {
    status: 200,
    body: { readAt: "2026-01-01T00:00:00.000Z", forums: 9 },
  };
  assert.deepEqual(await actions.markAllForumsReadAction({}), { done: true });
  assert.equal(asked[0].method, "PUT");
  assert.equal(asked[0].url, `${ROOT}/nodes/read`);
});

test("the backend's refusal of a mark read is what the form shows", async () => {
  answer = {
    status: 404,
    body: { error: { code: "not_found", message: "No such forum." } },
  };
  assert.deepEqual(await actions.markForumReadAction(4, {}), {
    error: "No such forum.",
  });
  assert.deepEqual(await actions.markAllForumsReadAction({}), {
    error: "No such forum.",
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
    tags: [],
  });
  const bad = form({ title: "T", body: "B" });
  bad.append("attachmentIds", "0");
  await assert.rejects(() => actions.createThreadAction(4, {}, bad));
});

test("the tags field is sent as a list of names, without the # and without repeats", async () => {
  answer = {
    status: 403,
    body: { error: { code: "forbidden", message: "No." } },
  };
  await actions.createThreadAction(
    4,
    {},
    form({ title: "T", body: "B", tags: "#Rust, tutorial  #rust;café" }),
  );
  const sent = asked[asked.length - 1]?.body as { tags: string[] };
  assert.deepEqual(sent.tags, ["Rust", "tutorial", "rust", "café"]);
});

const prefix = (id: number, isActive: boolean) => ({
  id,
  label: `Prefix ${id}`,
  color: "#22aa66",
  icon: "",
  colorId: 1,
  position: id,
  isActive,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const forumAnswer = (uploads: boolean, poll = false, required = false) => ({
  node: {
    id: 4,
    parentId: null,
    type: "forum",
    title: "Help",
    description: "",
    icon: null,
    iconKey: null,
    cover: null,
    position: 0,
    tabId: null,
    depth: 0,
    threadCount: 0,
    postCount: 0,
    lastPost: null,
    permissions: { canPost: true, canModerate: false },
    settings: {
      requireThreadApproval: false,
      requireReplyApproval: false,
      isReadOnly: false,
      countsPosts: true,
      minAccountAgeDays: 0,
      minPostCount: 0,
      requirePrefix: required,
    },
  },
  watching: null,
  seo: {
    title: "Help",
    description: "",
    canonical: "http://localhost/forums/4",
    robots: "index,follow",
    redirect: false,
    jsonLd: [],
  },
  breadcrumbs: [],
  resolvedPermissions: {
    "forum.uploadAttachments": uploads,
    "poll.create": poll,
  },
});

test("a forum says whether files and a poll may be added to a thread there, which prefixes it offers and whether it asks for one", async () => {
  const ask = async (uploads: boolean, poll: boolean, required = false) => {
    answer = { status: 200, body: forumAnswer(uploads, poll, required) };
    answers.set("/thread-prefixes", {
      status: 200,
      body: { items: [prefix(7, true), prefix(8, false)] },
    });
    const access = await actions.forumComposeAccessAction(4);
    return access && { ...access, prefixes: access.prefixes.map((p) => p.id) };
  };
  assert.deepEqual(await ask(true, true), {
    attach: true,
    poll: true,
    prefixes: [7],
    requirePrefix: false,
  });
  assert.equal(asked[0].url, `${ROOT}/nodes/4`);
  assert.equal(asked[1].url, `${ROOT}/thread-prefixes?nodeId=4`);
  assert.deepEqual(await ask(false, true), {
    attach: false,
    poll: true,
    prefixes: [7],
    requirePrefix: false,
  });
  assert.deepEqual(await ask(true, false), {
    attach: true,
    poll: false,
    prefixes: [7],
    requirePrefix: false,
  });
  assert.equal((await ask(true, true, true))?.requirePrefix, true);
  // A forum that offers no active prefix asks for none, whatever its setting says.
  answers.set("/thread-prefixes", {
    status: 200,
    body: { items: [prefix(8, false)] },
  });
  const none = await actions.forumComposeAccessAction(4);
  assert.deepEqual([none?.prefixes, none?.requirePrefix], [[], false]);
  answer = {
    status: 403,
    body: { error: { code: "forbidden", message: "No." } },
  };
  answers.clear();
  assert.equal(await actions.forumComposeAccessAction(4), null);
  await assert.rejects(() => actions.forumComposeAccessAction(0));
});

test("an id that is not a record id never becomes a path", async () => {
  for (const id of [".." as unknown as number, 0, -3, Number.NaN]) {
    await assert.rejects(() => actions.setForumWatch(id, null));
    await assert.rejects(() => actions.createThreadAction(id, {}, form({})));
  }
  assert.equal(asked.length, 0);
});

const batch = (fields: Record<string, string | string[]>) =>
  actions.batchUpdateThreadsAction(4, {}, form(fields));

test("a batch change sends the ticked threads, the change and the reason, and says how it went", async () => {
  answer = {
    status: 200,
    body: {
      results: [
        { threadId: 7, changed: true, error: null },
        { threadId: 8, changed: false, error: null },
        {
          threadId: 9,
          changed: false,
          error: { code: "forbidden", message: "No lock here." },
        },
      ],
    },
  };
  const state = await batch({
    threadIds: ["7", "8", "9"],
    action: "lock",
    reason: "calm",
  });
  assert.equal(state.done, true);
  assert.equal(state.error, undefined);
  assert.match(state.summary ?? "", /batchDone/);
  assert.match(state.summary ?? "", /batchRefused/);
  assert.equal(asked[0].method, "POST");
  assert.equal(asked[0].url, `${ROOT}/threads/batch`);
  assert.deepEqual(asked[0].body, {
    threadIds: [7, 8, 9],
    update: { action: "lock" },
    reason: "calm",
  });
});

test("a move names its forum and a prefix change may clear the prefix", async () => {
  answer = {
    status: 200,
    body: { results: [{ threadId: 7, changed: true, error: null }] },
  };
  await batch({ threadIds: ["7"], action: "move", forumId: "12" });
  assert.deepEqual((asked[0].body as { update: unknown }).update, {
    action: "move",
    nodeId: 12,
  });
  await batch({ threadIds: ["7"], action: "setPrefix", prefixId: "" });
  assert.deepEqual((asked[1].body as { update: unknown }).update, {
    action: "setPrefix",
    prefixId: null,
  });
  await batch({ threadIds: ["7"], action: "setPrefix", prefixId: "5" });
  assert.deepEqual((asked[2].body as { update: unknown }).update, {
    action: "setPrefix",
    prefixId: 5,
  });
});

test("a batch with nothing ticked, an unknown change, no forum or too many threads asks nothing", async () => {
  assert.deepEqual(await batch({ action: "lock" }), { error: "batchChoose" });
  assert.deepEqual(await batch({ threadIds: ["7"], action: "explode" }), {
    error: "batchChoose",
  });
  assert.deepEqual(await batch({ threadIds: ["7"], action: "move" }), {
    error: "noForum",
  });
  const many = Array.from({ length: 101 }, (_, i) => String(i + 1));
  assert.deepEqual(await batch({ threadIds: many, action: "lock" }), {
    error: "batchTooMany",
  });
  await assert.rejects(() => batch({ threadIds: ["0"], action: "lock" }));
  assert.equal(asked.length, 0);
});

test("a refusal of the whole batch is what the bar shows", async () => {
  answer = {
    status: 403,
    body: { error: { code: "forbidden", message: "Not for you." } },
  };
  assert.deepEqual(await batch({ threadIds: ["7"], action: "stick" }), {
    error: "Not for you.",
  });
});

test("a poll written with the thread travels with it, and a form without one sends none", async () => {
  answer = {
    status: 403,
    body: { error: { code: "forbidden", message: "No." } },
  };
  const poll = {
    kind: "poll",
    questions: [{ text: "Q?", answers: [{ text: "A" }, { text: "B" }] }],
  };
  await actions.createThreadAction(
    4,
    {},
    form({ title: "T", body: "B", poll: JSON.stringify(poll) }),
  );
  assert.deepEqual((asked[0].body as { poll: unknown }).poll, poll);
  asked.length = 0;
  await actions.createThreadAction(
    4,
    {},
    form({ title: "T", body: "B", poll: "" }),
  );
  assert.equal("poll" in (asked[0].body as object), false);
  // A poll field that is not a poll refuses the thread; nothing is sent without it.
  asked.length = 0;
  assert.deepEqual(
    await actions.createThreadAction(
      4,
      {},
      form({ title: "T", body: "B", poll: "not json" }),
    ),
    { error: "invalid", title: "T", prefixId: "" },
  );
  assert.equal(asked.length, 0);
});

test("the watch options of a new thread are sent as the author's choice, and a form without them leaves it to the preference", async () => {
  answer = {
    status: 403,
    body: { error: { code: "forbidden", message: "No." } },
  };
  const sent = async (fields: Record<string, string>) => {
    asked.length = 0;
    await actions.createThreadAction(
      4,
      {},
      form({ title: "T", body: "B", ...fields }),
    );
    return (asked[0].body as { watch?: string }).watch;
  };
  expect(await sent({ watchChoice: "1", watch: "on", watchEmail: "on" })).toBe(
    "watch_email",
  );
  expect(await sent({ watchChoice: "1", watch: "on" })).toBe("watch");
  // Unticked boxes send nothing; the choice is still made: not watching.
  expect(await sent({ watchChoice: "1" })).toBe("none");
  expect(await sent({})).toBeUndefined();
});
