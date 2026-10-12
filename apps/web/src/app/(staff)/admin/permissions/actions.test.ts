import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { permissionDefinitionBody } from "@/lib/test-bodies";
import { translator } from "@/lib/test-intl";
import { fakeBackend, refusal } from "../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { savePermissions } = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const definition = permissionDefinitionBody;

const DEFINITIONS = {
  items: [
    definition("forum.react", "flag"),
    definition("forum.edit", "flag", "node"),
    definition("forum.maxLinks", "integer"),
  ],
};

const set = (entries: unknown[], nodeId: number | null = null) => ({
  groupId: 4,
  userId: null,
  nodeId,
  entries,
});

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

const answers = (current: unknown[] = []) => ({
  "permissions.definitions": () => Response.json(DEFINITIONS),
  "permissions.list": () => Response.json(set(current)),
  "permissions.set": () => Response.json(set([])),
});

test("a wrong password changes nothing and shows on the password field", async () => {
  backend = fakeBackend({
    ...answers(),
    "permissions.set": () =>
      refusal(403, "forbidden", "That is not your password."),
  });
  expect(
    await savePermissions(
      null,
      form({ group: "4", actorPassword: "nope", "perm:forum.react": "allow" }),
    ),
  ).toEqual({ fields: { actorPassword: "That is not your password." } });
  expect(backend.asked.at(-1)).toMatchObject({
    operation: "permissions.set",
    body: { actorPassword: "nope" },
  });
});

test("the limit on wrong passwords shows its own message on the password field", async () => {
  backend = fakeBackend({
    ...answers(),
    "permissions.set": () =>
      refusal(
        429,
        "rate_limited",
        "Too many wrong passwords. Try again later.",
      ),
  });
  expect(
    await savePermissions(
      null,
      form({ group: "4", actorPassword: "nope", "perm:forum.react": "allow" }),
    ),
  ).toEqual({
    fields: { actorPassword: "Too many wrong passwords. Try again later." },
  });
});

test("a missing password is asked for without calling the backend", async () => {
  backend = fakeBackend({});
  expect(
    await savePermissions(null, form({ group: "4", actorPassword: "" })),
  ).toEqual({
    fields: { actorPassword: messages.adminGroups.errors.password },
  });
  expect(backend.asked).toEqual([]);
});

test("only the changed entries are sent, with the password in the same write", async () => {
  backend = fakeBackend(
    answers([{ permission: "forum.react", value: "allow" }]),
  );
  const digest = await redirectedTo(() =>
    savePermissions(
      null,
      form({
        group: "4",
        actorPassword: "secret",
        "perm:forum.react": "allow",
        "perm:forum.edit": "never",
        "perm:forum.maxLinks": "value",
        "num:forum.maxLinks": "5",
      }),
    ),
  );
  expect(digest).toMatch(/;\/admin\/permissions\/groups\/4\?notice=saved;/);
  expect(backend.asked.map((entry) => entry.operation)).not.toContain(
    "auth.verifyPassword",
  );
  expect(backend.asked.at(-1)).toMatchObject({
    operation: "permissions.set",
    body: {
      groupId: 4,
      nodeId: null,
      entries: [
        { permission: "forum.edit", value: "never" },
        { permission: "forum.maxLinks", value: 5 },
      ],
      actorPassword: "secret",
    },
  });
});

test("a form with nothing changed says so and writes nothing", async () => {
  backend = fakeBackend(answers());
  expect(
    await savePermissions(
      null,
      form({ group: "4", actorPassword: "secret", "perm:forum.react": "" }),
    ),
  ).toEqual({ notice: messages.adminGroups.matrix.unchanged });
  expect(backend.asked.map((entry) => entry.operation)).not.toContain(
    "permissions.set",
  );
});

test("on a forum only the forum permissions are read, and No is allowed", async () => {
  backend = fakeBackend(answers());
  const digest = await redirectedTo(() =>
    savePermissions(
      null,
      form({
        user: "9",
        node: "3",
        actorPassword: "secret",
        "perm:forum.edit": "no",
        "perm:forum.react": "never",
      }),
    ),
  );
  expect(digest).toMatch(
    /;\/admin\/permissions\/forums\?node=3&user=9&notice=saved;/,
  );
  expect(backend.asked.at(-1)?.body).toEqual({
    userId: 9,
    nodeId: 3,
    entries: [{ permission: "forum.edit", value: "no" }],
    actorPassword: "secret",
  });
});

test("No is refused at the global scope", async () => {
  backend = fakeBackend(answers());
  const state = await savePermissions(
    null,
    form({ group: "4", actorPassword: "secret", "perm:forum.react": "no" }),
  );
  expect(state?.error).toBeDefined();
  expect(backend.asked.map((entry) => entry.operation)).not.toContain(
    "permissions.set",
  );
});

test("a target that is not exactly one group or one member is refused", async () => {
  backend = fakeBackend({});
  const both = await savePermissions(
    null,
    form({ group: "4", user: "9", actorPassword: "x" }),
  );
  const neither = await savePermissions(null, form({ actorPassword: "x" }));
  const badNode = await savePermissions(
    null,
    form({ group: "4", node: "abc", actorPassword: "x" }),
  );
  for (const state of [both, neither, badNode]) {
    expect(state).toEqual({ error: messages.adminGroups.errors.target });
  }
  expect(backend.asked).toEqual([]);
});

test("the refusal of the change is shown at the top", async () => {
  backend = fakeBackend({
    ...answers(),
    "permissions.set": () =>
      refusal(409, "conflict", "Cannot remove the last administrator."),
  });
  expect(
    await savePermissions(
      null,
      form({
        group: "4",
        actorPassword: "secret",
        "perm:forum.react": "never",
      }),
    ),
  ).toEqual({ error: "Cannot remove the last administrator." });
});
