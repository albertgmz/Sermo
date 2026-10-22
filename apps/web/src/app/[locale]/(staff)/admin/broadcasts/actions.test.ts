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

const { resumeCount, resumeSend, runBroadcast, stopRun } = await import(
  "./actions"
);
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

test("a count asks for no password and sends dryRun with the audience as a rule", async () => {
  backend = fakeBackend({
    "broadcasts.start": () => Response.json({ queued: true }),
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
      rule: {
        match: "all",
        conditions: [{ criterion: "in_group", ids: [3, 5] }],
      },
      dryRun: true,
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

test("the send needs the confirmation and the password first, then sends them with the rule", async () => {
  backend = fakeBackend({
    "broadcasts.start": () => Response.json({ queued: true }),
  });
  const rule = {
    match: "any",
    conditions: [{ criterion: "post_count", value: 5 }],
  };
  const base = {
    ...message,
    step: "send",
    audience: "rule",
    rule: JSON.stringify(rule),
  };
  expect(await runBroadcast(null, form(base))).toEqual({
    error: words.errors.confirm,
  });
  expect(await runBroadcast(null, form({ ...base, confirm: "on" }))).toEqual({
    fields: { actorPassword: messages.adminGroups.errors.password },
  });
  expect(backend.asked).toEqual([]);
  expect(
    await runBroadcast(
      null,
      form({ ...base, confirm: "on", actorPassword: "secret" }),
    ),
  ).toEqual({ notice: words.result.sendQueued });
  expect(backend.asked.map((call) => call.body)).toEqual([
    {
      content: {
        kind: "message",
        title: "Hello",
        body: "Body",
        locked: false,
        removeFromSender: false,
      },
      rule,
      actorPassword: "secret",
    },
  ]);
});

test("a refusal of the backend, and a run already under way, come back as the form's state", async () => {
  backend = fakeBackend({
    "broadcasts.start": () => refusal(403, "forbidden", "Not allowed."),
  });
  expect(await runBroadcast(null, form({ ...message, step: "count" }))).toEqual(
    { error: "Not allowed." },
  );
  backend.restore();
  backend = fakeBackend({
    "broadcasts.start": () => Response.json({ queued: false }),
  });
  expect(await runBroadcast(null, form({ ...message, step: "count" }))).toEqual(
    { error: words.result.notQueued },
  );
});

test("resuming sends no content, the send with the password and the count without", async () => {
  backend = fakeBackend({
    "broadcasts.start": () => Response.json({ queued: true }),
    "broadcasts.stop": () => Response.json({ stopped: true }),
  });
  expect(await resumeSend(null, form({}))).toEqual({
    fields: { actorPassword: messages.adminGroups.errors.password },
  });
  expect(await resumeSend(null, form({ actorPassword: "secret" }))).toEqual({
    notice: words.run.queued,
  });
  expect(await resumeCount(null)).toEqual({ notice: words.run.countResumed });
  expect(backend.asked.map((call) => call.body)).toEqual([
    { actorPassword: "secret" },
    { dryRun: true },
  ]);
  expect(await stopRun(null)).toEqual({ notice: words.run.stopRequested });
  backend.restore();
  backend = fakeBackend({
    "broadcasts.stop": () => Response.json({ stopped: false }),
  });
  expect(await stopRun(null)).toEqual({ error: words.run.nothingToStop });
});
