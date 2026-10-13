import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { groupBody } from "@/lib/test-bodies";
import { translator } from "@/lib/test-intl";
import {
  fakeBackend,
  refusal,
  tooManyWrongPasswords,
  wrongPassword,
} from "./test-backend";

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

// Every group form carries the administrator's password, which the write is sent with.
function form(fields: Record<string, string>) {
  const data = new FormData();
  data.set("actorPassword", "secret");
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
        actorPassword: "secret",
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

test("the API's general request limit shows at the top of the form, not on the password field", async () => {
  backend = fakeBackend({
    "groups.update": () => refusal(429, "rate_limited", "Too many requests."),
  });
  expect(
    await saveGroup(null, form({ id: "7", title: "A", rank: "1" })),
  ).toEqual({ error: "Too many requests." });
});

test("a wrong password shows on the password field and the limit shows its message", async () => {
  backend = fakeBackend({
    "groups.update": () => wrongPassword(),
    "groups.delete": () => tooManyWrongPasswords(),
  });
  expect(
    await saveGroup(null, form({ id: "7", title: "A", rank: "1" })),
  ).toEqual({ fields: { actorPassword: "That is not your password." } });
  expect(await deleteGroup(null, form({ id: "7" }))).toEqual({
    fields: { actorPassword: "Too many wrong passwords. Try again later." },
  });
});

test("a missing password is asked for before the backend is", async () => {
  backend = fakeBackend({});
  const data = form({ id: "7", title: "A", rank: "1" });
  data.set("actorPassword", "");
  expect(await saveGroup(null, data)).toEqual({
    fields: { actorPassword: messages.adminGroups.errors.password },
  });
  expect(backend.asked).toEqual([]);
});

test("a refusal is tied to the password field by the field the backend names, not by its words", async () => {
  backend = fakeBackend({
    "groups.update": () =>
      refusal(403, "forbidden", "That is not your password."),
    "groups.delete": () =>
      refusal(
        429,
        "rate_limited",
        "Too many wrong passwords. Try again later.",
      ),
  });
  expect(
    await saveGroup(null, form({ id: "7", title: "A", rank: "1" })),
  ).toEqual({ error: "That is not your password." });
  expect(await deleteGroup(null, form({ id: "7" }))).toEqual({
    error: "Too many wrong passwords. Try again later.",
  });
});
