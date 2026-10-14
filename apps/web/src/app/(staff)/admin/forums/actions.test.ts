import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { fakeBackend, refusal, wrongPassword } from "../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));
const cache = await import("next/cache");
const renewed: string[] = [];
mock.module("next/cache", () => ({
  ...cache,
  revalidatePath: (path: string) => renewed.push(path),
  revalidateTag: (tag: string) => renewed.push(tag),
}));

const {
  createNode,
  saveNode,
  saveOrder,
  saveNodePictures,
  setModerator,
  saveTab,
  deleteTab,
  savePrefix,
  deletePrefix,
} = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => {
  backend?.restore();
  renewed.length = 0;
});
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => cache);
});

const NODE = {
  id: 9,
  parentId: null,
  type: "forum",
  title: "News",
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
  permissions: { canPost: true, canModerate: true },
  settings: {
    requireThreadApproval: false,
    requireReplyApproval: false,
    isReadOnly: false,
    minAccountAgeDays: 0,
    minPostCount: 0,
  },
};
const TAB = {
  id: 1,
  title: "Main",
  position: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const PREFIX = {
  ...TAB,
  id: 2,
  label: "Solved",
  color: "#112233",
  icon: "",
  colorId: 4,
  isActive: true,
};

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

test("a new forum is created with what the form showed and opens its editor", async () => {
  backend = fakeBackend({ "nodes.create": () => Response.json(NODE) });
  const digest = await redirectedTo(() =>
    createNode(
      null,
      form({
        type: "forum",
        title: "News",
        description: "",
        parentId: "3",
        position: "2",
        tabId: "",
        iconKey: "gamepad-2",
      }),
    ),
  );
  expect(digest).toMatch(/;\/admin\/forums\/9\?notice=created;/);
  expect(backend.asked[0].body).toEqual({
    type: "forum",
    parentId: 3,
    title: "News",
    description: "",
    position: 2,
    iconKey: "gamepad-2",
  });
  expect(renewed).toContain("/");
});

test("a node of a kind that does not exist is refused before the backend is asked", async () => {
  backend = fakeBackend({});
  expect(await createNode(null, form({ type: "board", title: "A" }))).toEqual({
    error: messages.adminForums.errors.type,
  });
  expect(
    await createNode(null, form({ type: "forum", title: "A", parentId: "x" })),
  ).toEqual({ fields: { parentId: messages.adminForums.errors.choice } });
  expect(backend.asked).toEqual([]);
});

test("the editor sends every field it showed, the tab only for a root node", async () => {
  backend = fakeBackend({ "nodes.update": () => Response.json(NODE) });
  await redirectedTo(() =>
    saveNode(
      null,
      form({
        id: "9",
        title: "News",
        description: "d",
        parentId: "",
        position: "4",
        hasTab: "1",
        tabId: "2",
        iconKey: "",
        isReadOnly: "on",
        minAccountAgeDays: "3",
        minPostCount: "10",
      }),
    ),
  );
  expect(backend.asked[0].body).toEqual({
    parentId: null,
    title: "News",
    description: "d",
    position: 4,
    iconKey: null,
    tabId: 2,
    settings: {
      requireThreadApproval: false,
      requireReplyApproval: false,
      isReadOnly: true,
      minAccountAgeDays: 3,
      minPostCount: 10,
    },
  });
  await redirectedTo(() =>
    saveNode(null, form({ id: "9", title: "News", position: "4" })),
  );
  expect(backend.asked[1].body).not.toHaveProperty("tabId");
  expect(backend.asked[1].body).not.toHaveProperty("iconKey");
});

test("a count that is not a whole number is shown under its field", async () => {
  backend = fakeBackend({});
  expect(
    await saveNode(
      null,
      form({ id: "9", title: "A", position: "1", minPostCount: "many" }),
    ),
  ).toEqual({ fields: { minPostCount: messages.adminForums.errors.whole } });
  expect(await saveNode(null, form({ id: "09", title: "A" }))).toEqual({
    error: messages.adminForums.errors.id,
  });
  expect(backend.asked).toEqual([]);
});

test("a cycle the backend refuses comes back as the form's message", async () => {
  backend = fakeBackend({
    "nodes.update": () =>
      refusal(409, "conflict", "A node cannot go under itself."),
  });
  expect(
    await saveNode(
      null,
      form({ id: "9", title: "A", parentId: "9", position: "1" }),
    ),
  ).toEqual({ error: "A node cannot go under itself." });
});

test("saving the order sends only the nodes whose number changed", async () => {
  backend = fakeBackend({ "nodes.update": () => Response.json(NODE) });
  const digest = await redirectedTo(() =>
    saveOrder(
      null,
      form({
        "before:1": "0",
        "position:1": "0",
        "before:2": "1",
        "position:2": "5",
        "before:3": "2",
        "position:3": "1",
      }),
    ),
  );
  expect(digest).toMatch(/;\/admin\/forums\?notice=ordered;/);
  expect(backend.asked.map((call) => call.body)).toEqual([
    { position: 5 },
    { position: 1 },
  ]);
  expect(backend.asked.map((call) => call.path)).toEqual([
    "/api/v1/nodes/2",
    "/api/v1/nodes/3",
  ]);
});

test("an order that is not a number is refused as a whole", async () => {
  backend = fakeBackend({});
  expect(
    await saveOrder(null, form({ "before:1": "0", "position:1": "first" })),
  ).toEqual({ error: messages.adminForums.errors.order });
  expect(backend.asked).toEqual([]);
});

test("pictures: a new file is attached, a removal sends null, nothing chosen is refused", async () => {
  backend = fakeBackend({
    "images.setNodeIcon": () => Response.json({ fileId: 5, url: "/x" }),
    "images.setNodeCover": () => Response.json(null),
  });
  const digest = await redirectedTo(() =>
    saveNodePictures(
      null,
      form({ id: "9", icon: "5", cover: "", coverRemove: "1" }),
    ),
  );
  expect(digest).toMatch(/;\/admin\/forums\/9\?notice=pictures;/);
  expect(backend.asked.map((call) => call.body)).toEqual([
    { fileId: 5 },
    { fileId: null },
  ]);
  expect(await saveNodePictures(null, form({ id: "9" }))).toEqual({
    error: messages.adminForums.errors.nothingChosen,
  });
  expect(await saveNodePictures(null, form({ id: "9", icon: "abc" }))).toEqual({
    fields: { icon: messages.adminForums.errors.file },
  });
});

test("a moderator is added and removed through the node", async () => {
  backend = fakeBackend({
    "nodes.setModerator": () => Response.json({ ok: true }),
  });
  const added = await redirectedTo(() =>
    setModerator(null, form({ id: "9", userId: "4", actorPassword: "secret" })),
  );
  expect(added).toMatch(/notice=moderated#moderators/);
  const removed = await redirectedTo(() =>
    setModerator(
      null,
      form({ id: "9", userId: "4", remove: "1", actorPassword: "secret" }),
    ),
  );
  expect(removed).toMatch(/notice=unmoderated#moderators/);
  expect(backend.asked.map((call) => call.body)).toEqual([
    { remove: false, actorPassword: "secret" },
    { remove: true, actorPassword: "secret" },
  ]);
  expect(await setModerator(null, form({ id: "9", userId: "me" }))).toEqual({
    error: messages.adminForums.errors.id,
  });
  expect(await setModerator(null, form({ id: "9", userId: "4" }))).toEqual({
    fields: { actorPassword: messages.adminGroups.errors.password },
  });
});

test("a wrong password for a moderator change shows on the password field", async () => {
  backend = fakeBackend({
    "nodes.setModerator": () => wrongPassword(),
  });
  expect(
    await setModerator(
      null,
      form({ id: "9", userId: "4", actorPassword: "nope" }),
    ),
  ).toEqual({ fields: { actorPassword: "That is not your password." } });
});

test("the backend's refusal of a moderator is shown", async () => {
  backend = fakeBackend({
    "nodes.setModerator": () =>
      refusal(403, "forbidden", "You may not change permissions."),
  });
  expect(
    await setModerator(
      null,
      form({ id: "9", userId: "4", actorPassword: "secret" }),
    ),
  ).toEqual({
    error: "You may not change permissions.",
  });
});

test("a tab is added without an id and changed with one", async () => {
  backend = fakeBackend({
    "forumTabs.create": () => Response.json(TAB),
    "forumTabs.update": () => Response.json(TAB),
  });
  await redirectedTo(() =>
    saveTab(null, form({ title: "Main", position: "" })),
  );
  await redirectedTo(() =>
    saveTab(null, form({ id: "1", title: "Primary", position: "2" })),
  );
  expect(backend.asked.map((call) => [call.operation, call.body])).toEqual([
    ["forumTabs.create", { title: "Main" }],
    ["forumTabs.update", { title: "Primary", position: 2 }],
  ]);
});

test("a tab is deleted by its id", async () => {
  backend = fakeBackend({
    "forumTabs.delete": () => Response.json({ ok: true }),
  });
  const digest = await redirectedTo(() => deleteTab(null, form({ id: "1" })));
  expect(digest).toMatch(/notice=tabDeleted#tabs/);
  expect(await deleteTab(null, form({ id: "-1" }))).toEqual({
    error: messages.adminForums.errors.id,
  });
});

test("a prefix is created with every field the form showed", async () => {
  backend = fakeBackend({
    "threadPrefixes.create": () => Response.json(PREFIX),
  });
  const digest = await redirectedTo(() =>
    savePrefix(
      null,
      form({
        label: "Solved",
        colorId: "4",
        icon: "circle-check",
        position: "1",
        isActive: "on",
      }),
    ),
  );
  expect(digest).toMatch(/;\/admin\/forums\/prefixes\?notice=created;/);
  expect(backend.asked[0].body).toEqual({
    label: "Solved",
    colorId: 4,
    icon: "circle-check",
    position: 1,
    isActive: true,
  });
});

test("a prefix without a colour is refused before the backend is asked", async () => {
  backend = fakeBackend({});
  expect(await savePrefix(null, form({ label: "Solved" }))).toEqual({
    fields: { colorId: messages.adminForums.errors.colour },
  });
  expect(backend.asked).toEqual([]);
});

test("the backend's refusal of a prefix colour is shown under the colour", async () => {
  backend = fakeBackend({
    "threadPrefixes.update": () =>
      Response.json(
        {
          error: {
            code: "validation",
            message: "Invalid input",
            issues: [{ path: ["colorId"], message: "Not an active colour." }],
          },
        },
        { status: 422 },
      ),
  });
  expect(
    await savePrefix(null, form({ id: "2", label: "A", colorId: "4" })),
  ).toEqual({ error: undefined, fields: { colorId: "Not an active colour." } });
});

test("deleting a prefix in use says it was deactivated", async () => {
  backend = fakeBackend({
    "threadPrefixes.delete": () =>
      Response.json({ ok: true, deactivated: true }),
  });
  const digest = await redirectedTo(() =>
    deletePrefix(null, form({ id: "2" })),
  );
  expect(digest).toMatch(/notice=deactivated/);
});

test("an order refused part-way keeps what was saved, renews the public pages and names the row", async () => {
  let answered = 0;
  backend = fakeBackend({
    "nodes.update": () =>
      ++answered === 2
        ? refusal(403, "forbidden", "Not allowed.")
        : Response.json(NODE),
  });
  const state = await saveOrder(
    null,
    form({
      "before:1": "0",
      "position:1": "5",
      "title:1": "News",
      "before:2": "1",
      "position:2": "6",
      "title:2": "Rules",
      "before:3": "2",
      "position:3": "7",
      "title:3": "Help",
    }),
  );
  expect(state).toEqual({ error: messages.admin.ordering.partial });
  expect(backend.asked.map((call) => call.path)).toEqual([
    "/api/v1/nodes/1",
    "/api/v1/nodes/2",
  ]);
});
