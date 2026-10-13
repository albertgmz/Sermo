import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { form, invalid, redirectedTo } from "../content-kit/harness";
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

const {
  createReactionType,
  updateReactionType,
  setReactionTypeActive,
  saveReactionOrder,
} = await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const TYPE = {
  id: 4,
  title: "Like",
  emoji: "x",
  score: 1,
  position: 1,
  isActive: true,
};

test("a new type sends what the form showed and leaves an empty score to the backend", async () => {
  backend = fakeBackend({
    "reactionTypes.create": () => Response.json(TYPE),
  });
  const digest = await redirectedTo(() =>
    createReactionType(
      null,
      form([
        ["emoji", "x"],
        ["title", "Like"],
        ["score", ""],
        ["position", "5"],
        ["isActive", "on"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/reactions\?notice=created;/);
  expect(backend.asked[0]?.body).toEqual({
    emoji: "x",
    title: "Like",
    position: 5,
    isActive: true,
  });
});

test("a score that is not a number is refused without a call", async () => {
  backend = fakeBackend({});
  const state = await createReactionType(
    null,
    form([
      ["emoji", "x"],
      ["title", "Like"],
      ["score", "lots"],
    ]),
  );
  expect(backend.asked).toEqual([]);
  expect(state).toEqual({
    fields: { score: messages.adminContent.errors.number },
  });
});

test("the backend's refusal is shown next to its field", async () => {
  backend = fakeBackend({
    "reactionTypes.create": () => invalid("score", "Too high."),
  });
  const state = await createReactionType(
    null,
    form([
      ["emoji", "x"],
      ["title", "Like"],
      ["score", "99"],
    ]),
  );
  expect(state).toEqual({ fields: { score: "Too high." } });
});

test("an edit sends the type id and the three fields of the row", async () => {
  backend = fakeBackend({
    "reactionTypes.update": () => Response.json(TYPE),
  });
  const digest = await redirectedTo(() =>
    updateReactionType(
      null,
      form([
        ["id", "4"],
        ["emoji", "y"],
        ["title", "Love"],
        ["score", "-2"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/reactions\?notice=saved;/);
  expect(backend.asked[0]?.path).toEndWith("/4");
  expect(backend.asked[0]?.body).toEqual({
    emoji: "y",
    title: "Love",
    score: -2,
  });
});

test("an edit with a bad id is refused without a call", async () => {
  backend = fakeBackend({});
  const state = await updateReactionType(
    null,
    form([
      ["id", "../4"],
      ["score", "1"],
    ]),
  );
  expect(backend.asked).toEqual([]);
  expect(state).toEqual({ error: messages.adminContent.errors.id });
});

test("deactivating sends only the state", async () => {
  backend = fakeBackend({
    "reactionTypes.update": () => Response.json(TYPE),
  });
  const digest = await redirectedTo(() =>
    setReactionTypeActive(
      null,
      form([
        ["id", "4"],
        ["active", "0"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/reactions\?notice=deactivated;/);
  expect(backend.asked[0]?.path).toEndWith("/4");
  expect(backend.asked[0]?.body).toEqual({
    isActive: false,
  });
});

test("a state other than 0 or 1 is refused without a call", async () => {
  backend = fakeBackend({});
  const state = await setReactionTypeActive(
    null,
    form([
      ["id", "4"],
      ["active", "maybe"],
    ]),
  );
  expect(backend.asked).toEqual([]);
  expect(state).toEqual({ error: messages.adminContent.errors.id });
});

test("the order form updates only the types whose position changed", async () => {
  backend = fakeBackend({
    "reactionTypes.list": () =>
      Response.json({
        items: [
          { ...TYPE, id: 1, position: 1 },
          { ...TYPE, id: 2, position: 2 },
          { ...TYPE, id: 3, position: 3 },
        ],
      }),
    "reactionTypes.update": () => Response.json(TYPE),
  });
  const digest = await redirectedTo(() =>
    saveReactionOrder(
      null,
      form([
        ["position.1", "2"],
        ["position.2", "1"],
        ["position.3", "3"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/reactions\?notice=ordered;/);
  const updates = backend.asked.filter(
    (entry) => entry.operation === "reactionTypes.update",
  );
  expect(updates.map((entry) => entry.body)).toEqual([
    { position: 2 },
    { position: 1 },
  ]);
  expect(updates.map((entry) => entry.path.split("/").pop())).toEqual([
    "1",
    "2",
  ]);
});

test("a refused order is shown at the top", async () => {
  backend = fakeBackend({
    "reactionTypes.list": () => refusal(403, "forbidden", "Not allowed."),
  });
  const state = await saveReactionOrder(null, form([["position.1", "2"]]));
  expect(state).toEqual({ error: "Not allowed." });
});

test("an order refused part-way says that the earlier rows were saved", async () => {
  let answered = 0;
  backend = fakeBackend({
    "reactionTypes.list": () =>
      Response.json({
        items: [
          { ...TYPE, id: 1, position: 1 },
          { ...TYPE, id: 2, position: 2 },
          { ...TYPE, id: 3, position: 3 },
        ],
      }),
    "reactionTypes.update": () =>
      ++answered === 2 ? refusal(403, "forbidden", "No.") : Response.json(TYPE),
  });
  const state = await saveReactionOrder(
    null,
    form([
      ["position.1", "4"],
      ["position.2", "5"],
      ["position.3", "6"],
    ]),
  );
  expect(state).toEqual({ error: messages.admin.ordering.partial });
  expect(
    backend.asked.filter((entry) => entry.operation === "reactionTypes.update"),
  ).toHaveLength(2);
});
