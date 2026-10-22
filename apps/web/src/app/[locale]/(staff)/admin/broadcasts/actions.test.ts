import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { fakeBackend, refusal } from "../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const cache = await import("next/cache");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const renewed: string[] = [];
mock.module("next/cache", () => ({
  ...cache,
  revalidatePath: (path: string) => renewed.push(path),
  revalidateTag: () => {},
  updateTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => cache);
});

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields))
    for (const one of Array.isArray(value) ? value : [value])
      data.append(name, one);
  return data;
}

const {
  discardCount,
  discardSend,
  resumeCount,
  resumeSend,
  runBroadcast,
  sendCounted,
  stopRun,
} = await import("./actions");
const words = messages.adminCommunication.broadcasts;
const message = {
  kind: "message",
  title: "Hello",
  body: "Body",
  audience: "all",
};
const search = () =>
  Response.json({ items: [{ id: 7, username: "Wren", staff: false }] });

test("the test goes to the member the name picks, or to the administrator when it is empty", async () => {
  backend = fakeBackend({
    "users.search": search,
    "broadcasts.test": () =>
      Response.json({
        recipient: { id: 7, username: "Wren" },
        delivered: true,
        reason: null,
        conversationId: 12,
      }),
  });
  expect(
    await runBroadcast(
      null,
      form({ ...message, step: "test", recipient: "wren" }),
    ),
  ).toEqual({
    test: { name: "Wren", delivered: true, reason: null, conversationId: 12 },
  });
  await runBroadcast(null, form({ ...message, step: "test" }));
  expect(
    backend.asked
      .filter((call) => call.operation === "broadcasts.test")
      .map((call) => call.body),
  ).toEqual([
    {
      content: {
        kind: "message",
        title: "Hello",
        body: "Body",
        locked: false,
        removeFromSender: false,
      },
      recipientId: 7,
    },
    {
      content: {
        kind: "message",
        title: "Hello",
        body: "Body",
        locked: false,
        removeFromSender: false,
      },
    },
  ]);
  // An unknown name is refused on its field and nothing is sent.
  backend.asked.length = 0;
  expect(
    await runBroadcast(
      null,
      form({ ...message, step: "test", recipient: "nobody" }),
    ),
  ).toEqual({ fields: { recipient: words.errors.noMember } });
  expect(
    backend.asked.filter((call) => call.operation === "broadcasts.test"),
  ).toEqual([]);
});

test("a count asks for no password and sends the audience as a rule", async () => {
  backend = fakeBackend({
    "broadcasts.count": () => Response.json({ queued: true }),
  });
  renewed.length = 0;
  expect(
    await runBroadcast(
      null,
      form({
        kind: "alert",
        text: "Tonight",
        url: " /pages/x ",
        step: "count",
        audience: "groups",
        groupIds: ["3", "5"],
      }),
    ),
  ).toEqual({ notice: words.result.countQueued });
  expect(backend.asked.map((call) => call.body)).toEqual([
    {
      content: { kind: "alert", text: "Tonight", url: "/pages/x" },
      audience: {
        match: "all",
        conditions: [{ criterion: "in_group", ids: [3, 5] }],
      },
    },
  ]);
  expect(renewed).toEqual([
    "/[locale]/admin/broadcasts/message",
    "/[locale]/admin/broadcasts/alert",
  ]);
  // Groups chosen but none ticked.
  expect(
    await runBroadcast(
      null,
      form({ ...message, step: "count", audience: "groups" }),
    ),
  ).toEqual({ fields: { groups: words.errors.noGroups } });
});

test("a rule audience with no condition is refused, not taken for everyone", async () => {
  backend = fakeBackend({
    "broadcasts.count": () => Response.json({ queued: true }),
  });
  const empty = JSON.stringify({ match: "all", conditions: [] });
  expect(
    await runBroadcast(
      null,
      form({ ...message, step: "count", audience: "rule", rule: empty }),
    ),
  ).toEqual({ fields: { rule: words.errors.emptyRule } });
  expect(backend.asked).toEqual([]);
  // Every member stays the way to reach everyone.
  await runBroadcast(null, form({ ...message, step: "count" }));
  expect(
    backend.asked.map((call) => (call.body as { audience: unknown }).audience),
  ).toEqual(["everyone"]);
});

test("the count sends the rule it was given", async () => {
  backend = fakeBackend({
    "broadcasts.count": () => Response.json({ queued: true }),
  });
  const rule = {
    match: "any",
    conditions: [{ criterion: "post_count", value: 5 }],
  };
  await runBroadcast(
    null,
    form({
      ...message,
      step: "count",
      audience: "rule",
      rule: JSON.stringify(rule),
    }),
  );
  expect(backend.asked.map((call) => call.body)).toEqual([
    {
      content: {
        kind: "message",
        title: "Hello",
        body: "Body",
        locked: false,
        removeFromSender: false,
      },
      audience: rule,
    },
  ]);
});

test("the send of the counted members asks for the password first and sends only that", async () => {
  backend = fakeBackend({
    "broadcasts.send": () => Response.json({ queued: true }),
  });
  expect(await sendCounted(null, form({}))).toEqual({
    fields: { actorPassword: messages.adminGroups.errors.password },
  });
  expect(backend.asked).toEqual([]);
  expect(
    await sendCounted(
      null,
      form({ countedAt: "2026-10-21T10:00:00.000Z", actorPassword: "secret" }),
    ),
  ).toEqual({
    notice: words.run.sendQueued,
  });
  expect(backend.asked.map((call) => call.body)).toEqual([
    { countedAt: "2026-10-21T10:00:00.000Z", actorPassword: "secret" },
  ]);
});

test("a refusal of the backend, and a run already under way, come back as the form's state", async () => {
  backend = fakeBackend({
    "broadcasts.count": () => refusal(403, "forbidden", "Not allowed."),
  });
  expect(await runBroadcast(null, form({ ...message, step: "count" }))).toEqual(
    { error: "Not allowed." },
  );
  backend.restore();
  backend = fakeBackend({
    "broadcasts.count": () => Response.json({ queued: false }),
  });
  expect(await runBroadcast(null, form({ ...message, step: "count" }))).toEqual(
    { error: words.result.notQueued },
  );
});

test("resuming, discarding and stopping send no content, only the run the panel showed", async () => {
  backend = fakeBackend({
    "broadcasts.resume": () => Response.json({ queued: true }),
    "broadcasts.discard": () => Response.json({ discarded: true }),
    "broadcasts.stop": () => Response.json({ stopped: true }),
  });
  const seen = { runAt: "2026-10-21T10:00:00.000Z", kind: "alert" };
  expect(await resumeSend(null, form(seen))).toEqual({
    fields: { actorPassword: messages.adminGroups.errors.password },
  });
  expect(await discardSend(null, form(seen))).toEqual({
    fields: { actorPassword: messages.adminGroups.errors.password },
  });
  // A form that does not name the run is not sent.
  expect(await resumeCount(null, form({}))).toEqual({
    error: messages.lib.errors.generic,
  });
  expect(backend.asked).toEqual([]);
  expect(
    await resumeSend(null, form({ ...seen, actorPassword: "secret" })),
  ).toEqual({
    notice: words.run.queued,
  });
  expect(await resumeCount(null, form(seen))).toEqual({
    notice: words.run.countResumed,
  });
  expect(
    await discardSend(null, form({ ...seen, actorPassword: "secret" })),
  ).toEqual({
    notice: words.run.discarded,
  });
  expect(await discardCount(null, form(seen))).toEqual({
    notice: words.run.discarded,
  });
  expect(await stopRun(null, form({ runAt: seen.runAt }))).toEqual({
    notice: words.run.stopRequested,
  });
  expect(backend.asked.map((call) => call.body)).toEqual([
    { ...seen, actorPassword: "secret" },
    seen,
    { ...seen, actorPassword: "secret" },
    seen,
    { runAt: seen.runAt },
  ]);
  backend.restore();
  backend = fakeBackend({
    "broadcasts.stop": () => Response.json({ stopped: false }),
  });
  expect(await stopRun(null, form({ runAt: seen.runAt }))).toEqual({
    error: words.run.nothingToStop,
  });
});
