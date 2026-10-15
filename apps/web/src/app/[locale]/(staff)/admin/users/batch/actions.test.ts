import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { fakeBackend, refusal, wrongPassword } from "../../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace, true),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { runBatch } = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const RULE = {
  match: "all",
  conditions: [{ criterion: "post_count", value: 0 }],
};

function form(fields: Record<string, string | boolean>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value === true) data.append(name, "on");
    else if (value !== false) data.append(name, value);
  }
  return data;
}

// A form as the page sends it: the rule typed, and the ids the last preview named.
const byRule = (fields: Record<string, string | boolean> = {}) =>
  form({
    selection: "criteria",
    rule: JSON.stringify(RULE),
    userIds: "1,2,3",
    ...fields,
  });

const found = (
  names: string[],
  extra: { unknown?: string[]; next?: number | null } = {},
) => ({
  items: names.map((username, index) => ({ id: index + 1, username })),
  unknown: extra.unknown ?? [],
  next: extra.next ?? null,
});

const outcomes = (
  items: {
    name: string;
    status: "done" | "skipped" | "failed";
    message?: string | null;
  }[],
) => ({
  items: items.map((item, index) => ({
    userId: index + 1,
    message: null,
    ...item,
  })),
  done: items.filter((item) => item.status === "done").length,
  skipped: items.filter((item) => item.status === "skipped").length,
  failed: items.filter((item) => item.status === "failed").length,
});

const sent = (operation: string) =>
  backend?.asked.filter((entry) => entry.operation === operation) ?? [];

// Preview ------------------------------------------------------------------------------------

test("a preview by a rule sends the rule and shows the count, the first names and where it resumes", async () => {
  const names = Array.from({ length: 30 }, (_, index) => `member${index}`);
  backend = fakeBackend({
    "users.batchPreview": () => Response.json(found(names, { next: 90 })),
  });
  const state = await runBatch(null, byRule({ step: "preview" }));
  expect(sent("users.batchPreview")[0]?.body).toEqual({
    selection: { kind: "criteria", rule: RULE },
  });
  expect(state).toEqual({
    preview: {
      ids: names.map((_, index) => index + 1),
      count: 30,
      names: names.slice(0, 20),
      unknown: [],
      next: 90,
    },
  });
});

test("a preview by a list sends each word once, trimmed, and reports the names nobody has", async () => {
  backend = fakeBackend({
    "users.batchPreview": () =>
      Response.json(found(["wren"], { unknown: ["ghost"] })),
  });
  const state = await runBatch(
    null,
    form({
      step: "preview",
      selection: "list",
      members: " wren, 12\nWREN\n\n ghost ,",
    }),
  );
  expect(sent("users.batchPreview")[0]?.body).toEqual({
    selection: { kind: "list", members: ["wren", "12", "ghost"] },
  });
  expect(state).toEqual({
    preview: {
      ids: [1],
      count: 1,
      names: ["wren"],
      unknown: ["ghost"],
      next: null,
    },
  });
});

test("a selection that names nobody, an empty rule and a bad step are refused without a call", async () => {
  backend = fakeBackend({
    "users.batchPreview": () => Response.json(found([])),
  });
  expect(
    await runBatch(
      null,
      form({ step: "preview", selection: "list", members: " , \n" }),
    ),
  ).toEqual({
    fields: { members: messages.adminUsers.batch.errors.noMembers },
  });
  const tooMany = Array.from({ length: 101 }, (_, index) => `m${index}`).join(
    "\n",
  );
  expect(
    await runBatch(
      null,
      form({ step: "preview", selection: "list", members: tooMany }),
    ),
  ).toEqual({
    fields: {
      members: messages.adminUsers.batch.errors.tooMany.replace(
        "{count}",
        "100",
      ),
    },
  });
  expect(
    await runBatch(
      null,
      form({
        step: "preview",
        selection: "criteria",
        rule: JSON.stringify({ match: "all", conditions: [] }),
      }),
    ),
  ).toEqual({
    fields: { rule: messages.adminUsers.batch.errors.noConditions },
  });
  expect(
    await runBatch(
      null,
      form({ step: "preview", selection: "criteria", rule: "not json" }),
    ),
  ).toHaveProperty("fields.rule");
  for (const step of [
    "",
    "delete",
    "apply@120",
    "preview@0",
    "preview@x",
    "preview@3x",
  ]) {
    expect(await runBatch(null, byRule({ step }))).toEqual({
      error: messages.lib.errors.generic,
    });
  }
  expect(backend.asked).toEqual([]);
});

test("the backend's refusal of a preview is the form's error", async () => {
  backend = fakeBackend({
    "users.batchPreview": () => refusal(403, "forbidden", "Not allowed."),
  });
  expect(await runBatch(null, byRule({ step: "preview" }))).toEqual({
    error: "Not allowed.",
  });
});

// Apply --------------------------------------------------------------------------------------

test("changing the primary group sends the group and the password, and shows what happened to each member", async () => {
  backend = fakeBackend({
    "users.batchUpdate": () =>
      Response.json(
        outcomes([
          { name: "wren", status: "done" },
          {
            name: "robin",
            status: "skipped",
            message: "Already in that primary group.",
          },
          {
            name: "#9",
            status: "failed",
            message: "No member goes by that name.",
          },
        ]),
      ),
  });
  const state = await runBatch(
    null,
    byRule({
      step: "apply",
      action: "setGroup",
      groupId: "5",
      actorPassword: "secret",
      reason: "  tidy up ",
    }),
  );
  expect(sent("users.batchUpdate")[0]?.body).toEqual({
    userIds: [1, 2, 3],
    action: { type: "setGroup", groupId: 5 },
    reason: "tidy up",
    actorPassword: "secret",
  });
  expect(state).toEqual({
    result: {
      items: [
        { name: "wren", status: "done", message: null },
        {
          name: "robin",
          status: "skipped",
          message: "Already in that primary group.",
        },
        {
          name: "#9",
          status: "failed",
          message: "No member goes by that name.",
        },
      ],
      done: 1,
      skipped: 1,
      failed: 1,
    },
  });
});

test("every group change asks for the password, and a wrong one is shown on that field", async () => {
  backend = fakeBackend({ "users.batchUpdate": () => wrongPassword() });
  for (const action of ["setGroup", "addGroup", "removeGroup"]) {
    expect(
      await runBatch(null, byRule({ step: "apply", action, groupId: "5" })),
    ).toHaveProperty("fields.actorPassword");
  }
  expect(backend.asked).toEqual([]);
  expect(
    await runBatch(
      null,
      byRule({
        step: "apply",
        action: "removeGroup",
        groupId: "5",
        actorPassword: "nope",
      }),
    ),
  ).toEqual({ fields: { actorPassword: "That is not your password." } });
  expect(
    await runBatch(
      null,
      byRule({
        step: "apply",
        action: "addGroup",
        groupId: "x",
        actorPassword: "p",
      }),
    ),
  ).toEqual({ fields: { groupId: messages.adminUsers.batch.errors.group } });
});

test("the next members are previewed after the id the button names, for a rule only", async () => {
  backend = fakeBackend({
    "users.batchPreview": () => Response.json(found(["wren"], { next: 250 })),
  });
  const state = await runBatch(null, byRule({ step: "preview@120" }));
  expect(sent("users.batchPreview")[0]?.body).toEqual({
    selection: { kind: "criteria", rule: RULE, after: 120 },
  });
  expect(state?.preview?.next).toBe(250);
  // A list is never resumed.
  await runBatch(
    null,
    form({ step: "preview@120", selection: "list", members: "wren" }),
  );
  expect(sent("users.batchPreview")[1]?.body).toEqual({
    selection: { kind: "list", members: ["wren"] },
  });
});

test("apply acts on the ids of the preview and does not read the rule or the list again", async () => {
  backend = fakeBackend({
    "users.batchUpdate": () =>
      Response.json(outcomes([{ name: "wren", status: "done" }])),
  });
  // The fields of the choice are not even valid: only the ids count.
  await runBatch(
    null,
    form({
      step: "apply",
      selection: "criteria",
      rule: "not json",
      userIds: " 7, 9,7 ",
      action: "removeAvatar",
    }),
  );
  expect(sent("users.batchUpdate")[0]?.body).toEqual({
    userIds: [7, 9],
    action: { type: "removeAvatar" },
    reason: "",
  });
  expect(sent("users.batchPreview")).toHaveLength(0);
});

test("apply without the ids of a preview is refused without a call", async () => {
  backend = fakeBackend({
    "users.batchUpdate": () => Response.json(outcomes([])),
  });
  const tooMany = Array.from({ length: 101 }, (_, index) => index + 1).join(
    ",",
  );
  for (const userIds of ["", " , ", "x", "1,x", "0", tooMany]) {
    expect(
      await runBatch(
        null,
        byRule({ step: "apply", action: "removeAvatar", userIds }),
      ),
    ).toEqual({ error: messages.adminUsers.batch.errors.noPreview });
  }
  expect(backend.asked).toEqual([]);
});

test("a ban or an erasure asks for the confirmation and the password on every run", async () => {
  backend = fakeBackend({
    "users.batchUpdate": () =>
      Response.json(outcomes([{ name: "wren", status: "done" }])),
  });
  const again = (fields: Record<string, string | boolean>) =>
    byRule({ step: "apply", reason: "spam", ...fields });
  expect(await runBatch(null, again({ action: "ban", days: "7" }))).toEqual({
    error: messages.adminUsers.batch.errors.confirm,
  });
  expect(
    await runBatch(null, again({ action: "delete", confirm: true })),
  ).toEqual({
    fields: { actorPassword: messages.adminGroups.errors.password },
  });
  expect(
    await runBatch(null, again({ action: "delete", actorPassword: "pw" })),
  ).toEqual({ error: messages.adminUsers.batch.errors.confirm });
  expect(backend.asked).toEqual([]);
  await runBatch(null, again({ action: "ban", days: "7", confirm: true }));
  expect(sent("users.batchUpdate")).toHaveLength(1);
});

test("the title is set, or cleared when left empty", async () => {
  backend = fakeBackend({
    "users.batchUpdate": () =>
      Response.json(outcomes([{ name: "wren", status: "done" }])),
  });
  await runBatch(
    null,
    byRule({ step: "apply", action: "setTitle", title: "  Veteran " }),
  );
  await runBatch(
    null,
    byRule({ step: "apply", action: "setTitle", title: "  " }),
  );
  expect(
    sent("users.batchUpdate").map(
      (entry) => (entry.body as { action: unknown }).action,
    ),
  ).toEqual([
    { type: "setTitle", title: "Veteran" },
    { type: "setTitle", title: null },
  ]);
});

test("a ban needs a reason, a confirmation and a length, and sends the notify switch", async () => {
  backend = fakeBackend({
    "users.batchUpdate": () =>
      Response.json(outcomes([{ name: "wren", status: "done" }])),
  });
  const ban = (fields: Record<string, string | boolean>) =>
    byRule({ step: "apply", action: "ban", ...fields });
  expect(await runBatch(null, ban({ days: "7", confirm: true }))).toEqual({
    fields: { reason: messages.adminUsers.batch.errors.reason },
  });
  expect(await runBatch(null, ban({ days: "7", reason: "spam" }))).toEqual({
    error: messages.adminUsers.batch.errors.confirm,
  });
  for (const days of ["0", "3651", "x", ""]) {
    expect(
      await runBatch(null, ban({ days, reason: "spam", confirm: true })),
    ).toEqual({ fields: { days: messages.adminUsers.batch.errors.days } });
  }
  expect(backend.asked).toEqual([]);
  await runBatch(
    null,
    ban({ days: "30", reason: "spam", confirm: true, notify: true }),
  );
  await runBatch(
    null,
    ban({ duration: "forever", days: "7", reason: "spam", confirm: true }),
  );
  expect(
    sent("users.batchUpdate").map(
      (entry) => (entry.body as { action: unknown }).action,
    ),
  ).toEqual([
    { type: "ban", days: 30, notify: true },
    { type: "ban", days: null, notify: false },
  ]);
  // A ban needs no password.
  expect(
    sent("users.batchUpdate").every(
      (entry) => !("actorPassword" in (entry.body as object)),
    ),
  ).toBe(true);
});

test("lifting bans sends the notify switch and needs no reason", async () => {
  backend = fakeBackend({
    "users.batchUpdate": () =>
      Response.json(outcomes([{ name: "wren", status: "done" }])),
  });
  await runBatch(
    null,
    byRule({ step: "apply", action: "liftBans", notify: true }),
  );
  expect(sent("users.batchUpdate")[0]?.body).toEqual({
    userIds: [1, 2, 3],
    action: { type: "liftBans", notify: true },
    reason: "",
  });
});

test("erasing needs a reason, a confirmation and the password", async () => {
  backend = fakeBackend({
    "users.batchUpdate": () =>
      Response.json(outcomes([{ name: "wren", status: "done" }])),
  });
  const erase = (fields: Record<string, string | boolean>) =>
    form({
      step: "apply",
      userIds: "4",
      action: "delete",
      ...fields,
    });
  expect(await runBatch(null, erase({}))).toEqual({
    fields: { reason: messages.adminUsers.batch.errors.reason },
  });
  expect(await runBatch(null, erase({ reason: "spam" }))).toEqual({
    error: messages.adminUsers.batch.errors.confirm,
  });
  expect(
    await runBatch(null, erase({ reason: "spam", confirm: true })),
  ).toHaveProperty("fields.actorPassword");
  expect(backend.asked).toEqual([]);
  await runBatch(
    null,
    erase({ reason: "spam", confirm: true, actorPassword: "secret" }),
  );
  expect(sent("users.batchUpdate")[0]?.body).toEqual({
    userIds: [4],
    action: { type: "delete" },
    reason: "spam",
    actorPassword: "secret",
  });
});

test("no change chosen, or one the form does not offer, is refused without a call", async () => {
  backend = fakeBackend({
    "users.batchUpdate": () => Response.json(outcomes([])),
  });
  for (const action of ["", "deleteEverything", "constructor"]) {
    expect(await runBatch(null, byRule({ step: "apply", action }))).toEqual({
      error: messages.adminUsers.batch.errors.noAction,
    });
  }
  expect(backend.asked).toEqual([]);
});

test("the backend's refusal of the change is the form's error", async () => {
  backend = fakeBackend({
    "users.batchUpdate": () => refusal(403, "forbidden", "You may not ban."),
  });
  expect(
    await runBatch(
      null,
      byRule({
        step: "apply",
        action: "ban",
        days: "3",
        reason: "spam",
        confirm: true,
      }),
    ),
  ).toEqual({ error: "You may not ban." });
});

test("a rule the backend finds too heavy to check is refused with its message", async () => {
  const message =
    "The criterion Posts in threads is too heavy to check while a request is served.";
  backend = fakeBackend({
    "users.batchPreview": () => refusal(400, "invalid_argument", message),
  });
  const state = await runBatch(null, byRule({ step: "preview" }));
  expect(JSON.stringify(state)).toContain(message);
});
