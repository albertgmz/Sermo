import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { form, invalid, redirectedTo } from "../../content-kit/harness";
import { fakeBackend, refusal } from "../../groups/test-backend";

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

const {
  saveWarningType,
  deleteWarningType,
  saveWarningAction,
  deleteWarningAction,
} = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const TYPE_OUT = {
  id: 1,
  name: "Spam",
  nameEn: "Spam",
  nameEs: "Correo basura",
  points: 2,
  expiryDays: 30,
  defaultReason: "",
  locked: false,
};
const ACTION_OUT = {
  id: 1,
  threshold: 5,
  kind: "ban",
  days: null,
  groupId: null,
  groupTitle: null,
  restrictionKind: null,
};

const TYPE = [
  ["nameEn", "Spam"],
  ["nameEs", "Correo basura"],
  ["points", "2"],
  ["expiryDays", "30"],
  ["defaultReason", "Posting spam"],
  ["locked", "on"],
] as [string, string][];

test("a new type is created with every field, and an empty expiry is none", async () => {
  backend = fakeBackend({
    "warningTypes.create": () => Response.json(TYPE_OUT),
  });
  const digest = await redirectedTo(() =>
    saveWarningType(
      null,
      form([
        ...TYPE.filter(([name]) => name !== "expiryDays"),
        ["expiryDays", ""],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/settings\/warnings\?notice=added;/);
  expect(backend.asked[0]?.body).toEqual({
    nameEn: "Spam",
    nameEs: "Correo basura",
    points: 2,
    expiryDays: null,
    defaultReason: "Posting spam",
    locked: true,
  });
});

test("a change of a type names it and a missing switch is off", async () => {
  backend = fakeBackend({
    "warningTypes.update": () => Response.json({ ...TYPE_OUT, id: 4 }),
  });
  const digest = await redirectedTo(() =>
    saveWarningType(
      null,
      form([["id", "4"], ...TYPE.filter(([name]) => name !== "locked")]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/settings\/warnings\?notice=saved;/);
  expect(backend.asked[0]?.path).toEndWith("/4");
  expect(backend.asked[0]?.body).toMatchObject({
    locked: false,
    expiryDays: 30,
  });
});

test("points that are not a number are refused without a call", async () => {
  backend = fakeBackend({});
  expect(
    await saveWarningType(
      null,
      form([...TYPE.slice(0, 2), ["points", "many"]]),
    ),
  ).toEqual({ fields: { points: messages.adminSetup.errors.number } });
  expect(
    await saveWarningType(
      null,
      form(TYPE.filter(([name]) => name !== "points")),
    ),
  ).toEqual({ fields: { points: messages.adminSetup.errors.number } });
  expect(backend.asked).toEqual([]);
});

test("the backend's refusal of a type is shown next to its field", async () => {
  backend = fakeBackend({
    "warningTypes.create": () => invalid("nameEn", "Too long."),
  });
  expect(await saveWarningType(null, form(TYPE))).toEqual({
    fields: { nameEn: "Too long." },
  });
});

test("deleting a type sends its id; a bad id is refused without a call", async () => {
  backend = fakeBackend({
    "warningTypes.delete": () => Response.json({ ok: true }),
  });
  expect(
    await redirectedTo(() => deleteWarningType(null, form([["id", "3"]]))),
  ).toMatch(/;\/admin\/settings\/warnings\?notice=deleted;/);
  expect(backend.asked[0]?.path).toEndWith("/3");
  expect(await deleteWarningType(null, form([["id", "x"]]))).toEqual({
    error: messages.adminSetup.errors.id,
  });
  expect(backend.asked).toHaveLength(1);
});

test("a ban action sends no group and no restriction, whatever the form posted", async () => {
  backend = fakeBackend({
    "warningActions.create": () => Response.json(ACTION_OUT),
  });
  const digest = await redirectedTo(() =>
    saveWarningAction(
      null,
      form([
        ["threshold", "10"],
        ["kind", "ban"],
        ["days", "7"],
        ["groupId", "5"],
        ["restrictionKind", "posting"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/settings\/warnings\?notice=added;/);
  expect(backend.asked[0]?.body).toEqual({
    threshold: 10,
    kind: "ban",
    days: 7,
    groupId: null,
    restrictionKind: null,
  });
});

test("a group action needs a group and a restriction action a kind; an empty length is permanent", async () => {
  backend = fakeBackend({
    "warningActions.update": () => Response.json({ ...ACTION_OUT, id: 2 }),
  });
  expect(
    await saveWarningAction(
      null,
      form([
        ["threshold", "5"],
        ["kind", "group"],
        ["groupId", ""],
      ]),
    ),
  ).toEqual({ fields: { groupId: messages.adminSetup.errors.missing } });
  expect(
    await saveWarningAction(
      null,
      form([
        ["threshold", "5"],
        ["kind", "restriction"],
        ["restrictionKind", "everything"],
      ]),
    ),
  ).toEqual({
    fields: { restrictionKind: messages.adminSetup.errors.missing },
  });
  expect(backend.asked).toEqual([]);
  await redirectedTo(() =>
    saveWarningAction(
      null,
      form([
        ["id", "2"],
        ["threshold", "5"],
        ["kind", "group"],
        ["days", ""],
        ["groupId", "9"],
        ["restrictionKind", "posting"],
      ]),
    ),
  );
  expect(backend.asked[0]?.path).toEndWith("/2");
  expect(backend.asked[0]?.body).toEqual({
    threshold: 5,
    kind: "group",
    days: null,
    groupId: 9,
    restrictionKind: null,
  });
});

test("an action of an unknown kind or with a threshold that is not a number is refused", async () => {
  backend = fakeBackend({});
  expect(
    await saveWarningAction(
      null,
      form([
        ["threshold", "5"],
        ["kind", "erase"],
      ]),
    ),
  ).toEqual({ fields: { kind: messages.adminSetup.errors.missing } });
  expect(
    await saveWarningAction(
      null,
      form([
        ["threshold", "x"],
        ["kind", "ban"],
      ]),
    ),
  ).toEqual({ fields: { threshold: messages.adminSetup.errors.number } });
  expect(backend.asked).toEqual([]);
});

test("deleting an action sends its id and shows a refusal", async () => {
  backend = fakeBackend({
    "warningActions.delete": () => refusal(403, "forbidden", "Not allowed."),
  });
  expect(await deleteWarningAction(null, form([["id", "3"]]))).toEqual({
    error: "Not allowed.",
  });
  expect(await deleteWarningAction(null, form([["id", "x"]]))).toEqual({
    error: messages.adminSetup.errors.id,
  });
});
