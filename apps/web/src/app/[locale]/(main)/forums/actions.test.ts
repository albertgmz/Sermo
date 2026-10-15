import { afterEach, beforeEach, mock, test } from "bun:test";
import assert from "node:assert/strict";

const realFetch = globalThis.fetch;
const asked: { method: string; url: string; body: unknown }[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: {} };

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({ refresh: () => {} }));
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

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields))
    for (const each of Array.isArray(value) ? value : [value])
      data.append(name, each);
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

const forumAnswer = (uploads: boolean) => ({
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
      minAccountAgeDays: 0,
      minPostCount: 0,
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
  resolvedPermissions: { "forum.uploadAttachments": uploads },
});

test("a forum says whether files may be attached to a thread there", async () => {
  answer = { status: 200, body: forumAnswer(true) };
  assert.equal(await actions.forumAttachAllowedAction(4), true);
  assert.equal(asked[0].url, `${ROOT}/nodes/4`);
  answer = { status: 200, body: forumAnswer(false) };
  assert.equal(await actions.forumAttachAllowedAction(4), false);
  answer = {
    status: 403,
    body: { error: { code: "forbidden", message: "No." } },
  };
  assert.equal(await actions.forumAttachAllowedAction(4), false);
  await assert.rejects(() => actions.forumAttachAllowedAction(0));
});

test("an id that is not a record id never becomes a path", async () => {
  for (const id of [".." as unknown as number, 0, -3, Number.NaN]) {
    await assert.rejects(() => actions.watchForumAction(id, {}, form({})));
    await assert.rejects(() => actions.unwatchForumAction(id, {}));
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
