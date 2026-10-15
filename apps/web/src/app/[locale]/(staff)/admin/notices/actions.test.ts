import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { form, invalid, redirectedTo } from "../content-kit/harness";
import { fakeBackend, refusal } from "../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { createNotice, removeNotice, saveNotice } = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const NOTICE = {
  id: 3,
  title: "Maintenance",
  bodySource: "Tonight.",
  bodyHtml: "<p>Tonight.</p>",
  rule: { match: "all", conditions: [] },
  dismissible: true,
  active: true,
  startsAt: null,
  endsAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
// The form of a notice; `extra` replaces the fields it names.
const fields = (extra: [string, string][] = []): [string, string][] => [
  ...(
    [
      ["title", "Maintenance"],
      ["body", "Tonight.\r\nLate."],
      ["audience", "everyone"],
      ["dismissible", "on"],
      ["active", "on"],
    ] as [string, string][]
  ).filter(([name]) => !extra.some(([over]) => over === name)),
  ...extra,
];

test("a new notice is sent with its rule, switches and dates in UTC", async () => {
  backend = fakeBackend({ "notices.create": () => Response.json(NOTICE) });
  const digest = await redirectedTo(() =>
    createNotice(
      null,
      form(
        fields([
          ["startsAt", "2030-01-02T09:30"],
          ["endsAt", ""],
        ]),
      ),
    ),
  );
  expect(digest).toMatch(/;\/admin\/notices\?notice=created;/);
  expect(backend.asked[0]?.body).toEqual({
    title: "Maintenance",
    body: "Tonight.\nLate.",
    rule: { match: "all", conditions: [] },
    dismissible: true,
    active: true,
    startsAt: "2030-01-02T09:30:00.000Z",
    endsAt: null,
  });
});

test("unticked switches are sent off, and a group is kept only for the group audience", async () => {
  backend = fakeBackend({ "notices.create": () => Response.json(NOTICE) });
  await redirectedTo(() =>
    createNotice(
      null,
      form([
        ["title", "T"],
        ["body", "B"],
        ["audience", "members"],
        ["groupId", "3"],
      ]),
    ),
  );
  expect(backend.asked[0]?.body).toMatchObject({
    rule: { match: "all", conditions: [{ criterion: "is_guest", value: 0 }] },
    dismissible: false,
    active: false,
  });
  await redirectedTo(() =>
    createNotice(
      null,
      form([
        ["title", "T"],
        ["body", "B"],
        ["audience", "group"],
        ["groupId", "3"],
      ]),
    ),
  );
  expect(backend.asked[1]?.body).toMatchObject({
    rule: { match: "all", conditions: [{ criterion: "in_group", ids: [3] }] },
  });
  await redirectedTo(() =>
    createNotice(
      null,
      form([
        ["title", "T"],
        ["body", "B"],
        ["audience", "guests"],
      ]),
    ),
  );
  expect(backend.asked[2]?.body).toMatchObject({
    rule: { match: "all", conditions: [{ criterion: "is_guest", value: 1 }] },
  });
});

test("an audience that is not offered, a missing group or a bad date is refused before sending", async () => {
  backend = fakeBackend({});
  const errors = messages.adminCommunication.errors;
  expect(await createNotice(null, form(fields([["audience", "all"]])))).toEqual(
    { fields: { audience: errors.choice } },
  );
  expect(
    await createNotice(
      null,
      form([
        ["title", "T"],
        ["body", "B"],
        ["audience", "group"],
      ]),
    ),
  ).toEqual({ fields: { groupId: errors.group } });
  expect(
    await createNotice(null, form(fields([["startsAt", "soon"]]))),
  ).toEqual({ fields: { startsAt: errors.date } });
  expect(backend.asked).toEqual([]);
});

test("the backend's refusal is shown next to its field", async () => {
  backend = fakeBackend({
    "notices.create": () => invalid("title", "Too long."),
  });
  expect(await createNotice(null, form(fields()))).toEqual({
    fields: { title: "Too long." },
  });
});

test("saving changes the notice named by the form and returns to it", async () => {
  backend = fakeBackend({ "notices.update": () => Response.json(NOTICE) });
  const digest = await redirectedTo(() =>
    saveNotice(null, form([["id", "3"], ...fields()])),
  );
  expect(digest).toMatch(/;\/admin\/notices\/3\?notice=saved;/);
  expect(backend.asked[0]?.path).toBe("/api/v1/notices/3");
  expect(await saveNotice(null, form(fields()))).toEqual({
    error: messages.adminCommunication.errors.id,
  });
});

test("deleting sends the id and returns to the list; a refusal is shown", async () => {
  backend = fakeBackend({
    "notices.delete": () => Response.json({ ok: true }),
  });
  const digest = await redirectedTo(() =>
    removeNotice(null, form([["id", "3"]])),
  );
  expect(digest).toMatch(/;\/admin\/notices\?notice=removed;/);
  expect(backend.asked[0]?.path).toBe("/api/v1/notices/3");
  backend.restore();
  backend = fakeBackend({
    "notices.delete": () => refusal(404, "not_found", "Not found."),
  });
  expect(await removeNotice(null, form([["id", "3"]]))).toEqual({
    error: "Not found.",
  });
});

test("a custom rule is sent back as it was read, and a damaged one is refused before sending", async () => {
  backend = fakeBackend({ "notices.update": () => Response.json(NOTICE) });
  const rule = {
    match: "any",
    conditions: [{ criterion: "is_member", ids: [4, 5] }],
  };
  await redirectedTo(() =>
    saveNotice(
      null,
      form([
        ["id", "3"],
        ...fields([
          ["audience", "custom"],
          ["rule", JSON.stringify(rule)],
        ]),
      ]),
    ),
  );
  expect(backend.asked[0]?.body).toMatchObject({ rule });
  const errors = messages.adminCommunication.errors;
  expect(
    await saveNotice(
      null,
      form([
        ["id", "3"],
        ...fields([
          ["audience", "custom"],
          ["rule", "{broken"],
        ]),
      ]),
    ),
  ).toEqual({ fields: { audience: errors.choice } });
  expect(backend.asked).toHaveLength(1);
});
