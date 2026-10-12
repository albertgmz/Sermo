import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { groupBody } from "@/lib/test-bodies";
import { translator } from "@/lib/test-intl";
import { fakeBackend, refusal } from "./test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { saveGroup, deleteGroup } = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const GROUP = groupBody();

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
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

test("a new group is created with what the form showed and opens its own page", async () => {
  backend = fakeBackend({ "groups.create": () => Response.json(GROUP) });
  const digest = await redirectedTo(() =>
    saveGroup(
      null,
      form({
        title: "Writers",
        description: "",
        rank: "20",
        userTitle: "",
        badge: "",
        nameColorId: "3",
        isStaff: "on",
      }),
    ),
  );
  expect(digest).toMatch(/;\/admin\/groups\/7\?notice=created;/);
  expect(backend.asked).toMatchObject([
    {
      operation: "groups.create",
      body: {
        title: "Writers",
        description: "",
        rank: 20,
        userTitle: "",
        badge: "",
        nameColorId: 3,
        isStaff: true,
      },
    },
  ]);
});

test("a new group may leave the rank empty for the backend default", async () => {
  backend = fakeBackend({ "groups.create": () => Response.json(GROUP) });
  await redirectedTo(() =>
    saveGroup(null, form({ title: "Writers", rank: "", nameColorId: "" })),
  );
  expect(backend.asked[0].body).not.toHaveProperty("rank");
  expect(backend.asked[0].body).toHaveProperty("nameColorId", null);
});

test("an edited group is updated by its id", async () => {
  backend = fakeBackend({ "groups.update": () => Response.json(GROUP) });
  const digest = await redirectedTo(() =>
    saveGroup(null, form({ id: "7", title: "Writers", rank: "20" })),
  );
  expect(digest).toMatch(/;\/admin\/groups\/7\?notice=saved;/);
  expect(backend.asked[0].operation).toBe("groups.update");
  expect(backend.asked[0].path).toBe("/api/v1/groups/7");
});

test("a rank that is not a number is refused before the backend is asked", async () => {
  backend = fakeBackend({});
  expect(await saveGroup(null, form({ title: "A", rank: "high" }))).toEqual({
    fields: { rank: messages.adminGroups.errors.rank },
  });
  expect(backend.asked).toEqual([]);
});

test("an id that is not a record id is refused before the backend is asked", async () => {
  backend = fakeBackend({});
  expect(
    await saveGroup(null, form({ id: "0x7", title: "A", rank: "1" })),
  ).toEqual({ error: messages.adminGroups.errors.id });
  expect(await deleteGroup(null, form({ id: "1e2" }))).toEqual({
    error: messages.adminGroups.errors.id,
  });
  expect(backend.asked).toEqual([]);
});

test("the refusal of a field is shown under that field", async () => {
  backend = fakeBackend({
    "groups.create": () =>
      Response.json(
        {
          error: {
            code: "validation",
            message: "Invalid input",
            issues: [{ path: ["title"], message: "Too short." }],
          },
        },
        { status: 422 },
      ),
  });
  expect(await saveGroup(null, form({ title: "", rank: "5" }))).toEqual({
    error: undefined,
    fields: { title: "Too short." },
  });
});

test("deleting a built-in group shows the refusal and goes nowhere", async () => {
  backend = fakeBackend({
    "groups.delete": () =>
      refusal(409, "conflict", "A built-in group cannot be deleted."),
  });
  expect(await deleteGroup(null, form({ id: "2" }))).toEqual({
    error: "A built-in group cannot be deleted.",
  });
});

test("a deleted group goes back to the list with a notice", async () => {
  backend = fakeBackend({ "groups.delete": () => Response.json({ ok: true }) });
  const digest = await redirectedTo(() => deleteGroup(null, form({ id: "7" })));
  expect(digest).toMatch(/;\/admin\/groups\?notice=deleted;/);
  expect(backend.asked[0].operation).toBe("groups.delete");
});
