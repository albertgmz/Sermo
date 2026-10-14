import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { fakeBackend, refusal } from "../../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const cacheModule = await import("next/cache");
const expired: string[] = [];
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/cache", () => ({
  ...cacheModule,
  updateTag: (tag: string) => {
    expired.push(tag);
  },
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { addEntry, saveEntry, saveOrder, deleteEntry } = await import(
  "./actions"
);

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => {
  backend?.restore();
  expired.length = 0;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => cacheModule);
});

const ENTRY = {
  id: 5,
  location: "header",
  parentId: null,
  title: "Rules",
  target: "/pages/rules",
  position: 3,
  isEnabled: true,
  audience: "members",
  permission: null,
  icon: null,
  iconPosition: "before",
  builtin: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const entry = (id: number, position: number) => ({ ...ENTRY, id, position });

function form(fields: [string, string][]) {
  const data = new FormData();
  for (const [name, value] of fields) data.append(name, value);
  return data;
}

async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: unknown }).digest);
  }
  return undefined;
}

test("a new entry sends what the form showed and expires the site cache", async () => {
  backend = fakeBackend({ "navigation.create": () => Response.json(ENTRY) });
  const digest = await redirectedTo(() =>
    addEntry(
      null,
      form([
        ["location", "header"],
        ["parentId", ""],
        ["title", "Rules"],
        ["target", " /pages/rules "],
        ["position", ""],
        ["audience", "members"],
        ["permission", "admin.settings"],
        ["icon", "star"],
        ["iconPosition", "after"],
        ["isEnabled", "on"],
      ]),
    ),
  );
  expect(digest).toMatch(
    /;\/admin\/settings\/navigation\?notice=added&entry=5;/,
  );
  expect(backend.asked).toMatchObject([
    {
      operation: "navigation.create",
      body: {
        location: "header",
        parentId: null,
        title: "Rules",
        target: "/pages/rules",
        isEnabled: true,
        audience: "members",
        permission: null,
        icon: "star",
        iconPosition: "after",
      },
    },
  ]);
  expect(backend.asked[0]?.body).not.toHaveProperty("position");
  expect(expired).toEqual([]);
});

test("an audience of permission carries the permission, an empty target is a heading", async () => {
  backend = fakeBackend({ "navigation.create": () => Response.json(ENTRY) });
  await redirectedTo(() =>
    addEntry(
      null,
      form([
        ["location", "footer"],
        ["parentId", "4"],
        ["title", "Staff"],
        ["target", ""],
        ["position", "2"],
        ["audience", "permission"],
        ["permission", "admin.settings"],
      ]),
    ),
  );
  expect(backend.asked[0]?.body).toEqual({
    location: "footer",
    parentId: 4,
    title: "Staff",
    target: null,
    position: 2,
    isEnabled: false,
    audience: "permission",
    permission: "admin.settings",
  });
  expect(backend.asked[0]?.body).not.toHaveProperty("icon");
  expect(backend.asked[0]?.body).not.toHaveProperty("iconPosition");
});

test("an entry's own form without the icon fields sends neither, so the icon and side are kept", async () => {
  backend = fakeBackend({ "navigation.update": () => Response.json(ENTRY) });
  await redirectedTo(() =>
    saveEntry(
      null,
      form([
        ["id", "5"],
        ["title", "House rules"],
        ["audience", "everyone"],
      ]),
    ),
  );
  expect(backend.asked[0]?.body).not.toHaveProperty("icon");
  expect(backend.asked[0]?.body).not.toHaveProperty("iconPosition");
});

test("an unknown place, audience or parent is refused without a call", async () => {
  backend = fakeBackend({});
  const base: [string, string][] = [
    ["location", "header"],
    ["parentId", ""],
    ["title", "x"],
    ["audience", "everyone"],
  ];
  const swap = (name: string, value: string) =>
    base.map(
      ([key, was]) => [key, key === name ? value : was] as [string, string],
    );
  expect(await addEntry(null, form(swap("location", "sidebar")))).toEqual({
    fields: { location: messages.adminSetup.errors.missing },
  });
  expect(await addEntry(null, form(swap("audience", "admins")))).toEqual({
    fields: { audience: messages.adminSetup.errors.missing },
  });
  expect(await addEntry(null, form(swap("parentId", "0x4")))).toEqual({
    fields: { parentId: messages.adminSetup.errors.id },
  });
  expect(await addEntry(null, form(swap("audience", "permission")))).toEqual({
    fields: { permission: messages.adminSetup.errors.permission },
  });
  expect(backend.asked).toEqual([]);
});

test("the backend's message for a field is shown next to it", async () => {
  backend = fakeBackend({
    "navigation.create": () =>
      Response.json(
        {
          error: {
            code: "validation",
            message: "Invalid input",
            issues: [{ path: ["target"], message: "Use a path." }],
          },
        },
        { status: 422 },
      ),
  });
  expect(
    await addEntry(
      null,
      form([
        ["location", "header"],
        ["parentId", ""],
        ["title", "x"],
        ["target", "nope"],
        ["audience", "everyone"],
      ]),
    ),
  ).toEqual({ error: undefined, fields: { target: "Use a path." } });
  expect(expired).toEqual([]);
});

test("an entry's own form sends its title, switch and audience, never the order", async () => {
  backend = fakeBackend({ "navigation.update": () => Response.json(ENTRY) });
  await redirectedTo(() =>
    saveEntry(
      null,
      form([
        ["id", "5"],
        ["title", "House rules"],
        ["audience", "guests"],
        ["permission", "admin.settings"],
        ["icon", ""],
        ["iconPosition", "after"],
      ]),
    ),
  );
  expect(backend.asked).toMatchObject([
    {
      operation: "navigation.update",
      path: "/api/v1/navigation/entries/5",
      body: {
        title: "House rules",
        isEnabled: false,
        audience: "guests",
        permission: null,
        icon: null,
        iconPosition: "after",
      },
    },
  ]);
  expect(backend.asked[0]?.body).not.toHaveProperty("position");
  expect(expired).toEqual([]);
});

test("the order form sends only the entries whose number changed", async () => {
  backend = fakeBackend({
    "navigation.list": () =>
      Response.json({ items: [entry(1, 0), entry(2, 1), entry(3, 2)] }),
    "navigation.update": () => Response.json(ENTRY),
  });
  const digest = await redirectedTo(() =>
    saveOrder(
      null,
      form([
        ["position.1", "1"],
        ["position.2", "1"],
        ["position.3", "0"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/settings\/navigation\?notice=saved;/);
  expect(
    backend.asked.filter((asked) => asked.operation === "navigation.update"),
  ).toMatchObject([
    { path: "/api/v1/navigation/entries/1", body: { position: 1 } },
    { path: "/api/v1/navigation/entries/3", body: { position: 0 } },
  ]);
});

test("an order for an entry the list does not have is refused", async () => {
  backend = fakeBackend({
    "navigation.list": () => Response.json({ items: [entry(1, 0)] }),
  });
  expect(await saveOrder(null, form([["position.9", "1"]]))).toEqual({
    error: messages.adminSetup.errors.id,
  });
  expect(await saveOrder(null, form([["position.1", "first"]]))).toEqual({
    error: messages.adminSetup.errors.number,
  });
});

test("deleting calls the operation and a built-in entry's refusal is shown", async () => {
  backend = fakeBackend({
    "navigation.delete": () => Response.json({ ok: true }),
  });
  const digest = await redirectedTo(() =>
    deleteEntry(null, form([["id", "5"]])),
  );
  expect(digest).toMatch(/;\/admin\/settings\/navigation\?notice=deleted;/);
  backend.restore();
  backend = fakeBackend({
    "navigation.delete": () =>
      refusal(409, "conflict", "A built-in entry cannot be deleted."),
  });
  expect(await deleteEntry(null, form([["id", "1"]]))).toEqual({
    error: "A built-in entry cannot be deleted.",
  });
  expect(await deleteEntry(null, form([["id", "one"]]))).toEqual({
    error: messages.adminSetup.errors.id,
  });
});

test("an order refused part-way says that the earlier entries were saved", async () => {
  let answered = 0;
  backend = fakeBackend({
    "navigation.list": () =>
      Response.json({ items: [entry(1, 0), entry(2, 1), entry(3, 2)] }),
    "navigation.update": () =>
      ++answered === 2
        ? refusal(403, "forbidden", "No.")
        : Response.json(ENTRY),
  });
  const state = await saveOrder(
    null,
    form([
      ["position.1", "4"],
      ["position.2", "5"],
      ["position.3", "6"],
    ]),
  );
  expect(state).toEqual({ error: messages.admin.ordering.partial });
  expect(
    backend.asked.filter((asked) => asked.operation === "navigation.update"),
  ).toHaveLength(2);
  // The navigation is read on every request, so there is nothing to expire.
  expect(expired).toEqual([]);
});
