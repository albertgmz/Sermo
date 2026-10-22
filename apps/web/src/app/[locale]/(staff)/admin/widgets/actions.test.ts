import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { form, invalid, redirectedTo } from "../content-kit/harness";
import { fakeBackend, refusal } from "../groups/test-backend";

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

const { createWidget, duplicateWidget, removeWidget, saveOrder, saveWidget } =
  await import("./actions");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
});

const errors = messages.adminWidgets.errors;
const NO_RULE = { match: "all", conditions: [] };
// A widget as the backend answers a write.
const widget = (id: number) => ({
  id,
  type: "featured",
  options: {},
  position: "novedades_above",
  displayOrder: 0,
  title: null,
  phones: true,
  isEnabled: true,
  rule: NO_RULE,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});
const WIDGET = widget(9);
// The form of a statistics widget; `extra` replaces the fields it names.
const fields = (extra: [string, string][] = []): [string, string][] => [
  ...(
    [
      ["type", "forumStats"],
      ["position", "novedades_above"],
      ["title", "  Busiest  "],
      ["rule", JSON.stringify(NO_RULE)],
      ["isEnabled", "on"],
      ["phones", "on"],
      ["option.limit", "8"],
      ["option.topPosters", "on"],
    ] as [string, string][]
  ).filter(([name]) => !extra.some(([over]) => over === name)),
  ...extra,
];

test("a new widget is sent with its position, type, typed options, switches and rule", async () => {
  backend = fakeBackend({ "widgets.create": () => Response.json(WIDGET) });
  const digest = await redirectedTo(() => createWidget(null, form(fields())));
  expect(digest).toMatch(/;\/admin\/widgets\/9\?notice=added;/);
  expect(backend.asked[0]?.body).toEqual({
    position: "novedades_above",
    type: "forumStats",
    options: { limit: 8, topPosters: true },
    title: "Busiest",
    phones: true,
    isEnabled: true,
    rule: NO_RULE,
  });
});

test("unticked switches go as off, an empty title as none, and the rule as the builder wrote it", async () => {
  backend = fakeBackend({ "widgets.create": () => Response.json(WIDGET) });
  const rule = {
    match: "any",
    conditions: [
      { criterion: "is_guest", value: 1 },
      { criterion: "in_group", ids: [3] },
    ],
  };
  await redirectedTo(() =>
    createWidget(
      null,
      form([
        ["type", "featured"],
        ["position", "overview_top"],
        ["title", " "],
        ["rule", JSON.stringify(rule)],
      ]),
    ),
  );
  expect(backend.asked[0]?.body).toEqual({
    position: "overview_top",
    type: "featured",
    options: {},
    title: null,
    phones: false,
    isEnabled: false,
    rule,
  });
});

test("a text widget keeps its body with LF line breaks", async () => {
  backend = fakeBackend({ "widgets.create": () => Response.json(WIDGET) });
  await redirectedTo(() =>
    createWidget(
      null,
      form([
        ["type", "text"],
        ["position", "sidebar_top"],
        ["rule", JSON.stringify(NO_RULE)],
        ["option.body", "One\r\nTwo"],
      ]),
    ),
  );
  expect(backend.asked[0]?.body).toMatchObject({
    options: { body: "One\nTwo" },
  });
});

test("an unusable form is refused before anything is sent", async () => {
  backend = fakeBackend({});
  expect(await createWidget(null, form(fields([["type", "nope"]])))).toEqual({
    fields: { type: errors.type },
  });
  expect(
    await createWidget(null, form(fields([["position", "nowhere"]]))),
  ).toEqual({ fields: { position: errors.position } });
  expect(
    await createWidget(null, form(fields([["option.limit", "4"]]))),
  ).toEqual({
    fields: { "option.limit": "Enter a whole number from 5 to 20." },
  });
  expect(await createWidget(null, form(fields([["rule", "{broken"]])))).toEqual(
    { fields: { rule: messages.adminGroups.errors.rule } },
  );
  expect(backend.asked).toEqual([]);
});

test("the backend's refusal is shown next to the field it names, an option included", async () => {
  backend = fakeBackend({
    "widgets.create": () => invalid("title", "Too long."),
  });
  expect(await createWidget(null, form(fields()))).toEqual({
    fields: { title: "Too long." },
  });
  backend.restore();
  backend = fakeBackend({
    "widgets.create": () =>
      refusal(422, "validation", "Invalid input", [
        { path: ["options", "body"], message: "Too short." },
      ]),
  });
  expect(
    await createWidget(
      null,
      form([
        ["type", "text"],
        ["position", "sidebar_top"],
        ["rule", JSON.stringify(NO_RULE)],
        ["option.body", "x"],
      ]),
    ),
  ).toEqual({ fields: { "option.body": "Too short." } });
  backend.restore();
  backend = fakeBackend({
    "widgets.create": () => refusal(403, "forbidden", "Not allowed."),
  });
  expect(await createWidget(null, form(fields()))).toEqual({
    error: "Not allowed.",
  });
});

test("saving changes the widget named by the form and returns to it", async () => {
  backend = fakeBackend({ "widgets.update": () => Response.json(WIDGET) });
  const digest = await redirectedTo(() =>
    saveWidget(null, form([["id", "3"], ...fields()])),
  );
  expect(digest).toMatch(/;\/admin\/widgets\/3\?notice=saved;/);
  expect(backend.asked[0]?.path).toBe("/api/v1/widgets/3");
  expect(backend.asked[0]?.body).toMatchObject({
    type: "forumStats",
    options: { limit: 8, topPosters: true },
  });
  expect(await saveWidget(null, form(fields()))).toEqual({ error: errors.id });
});

test("a copy goes to the position chosen, or the widget's own, and its page opens", async () => {
  backend = fakeBackend({
    "widgets.duplicate": () => Response.json(widget(12)),
  });
  let digest = await redirectedTo(() =>
    duplicateWidget(
      null,
      form([
        ["id", "3"],
        ["position", "sidebar_bottom"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/widgets\/12\?notice=duplicated;/);
  expect(backend.asked[0]?.path).toBe("/api/v1/widgets/3/copies");
  expect(backend.asked[0]?.body).toEqual({ position: "sidebar_bottom" });
  digest = await redirectedTo(() => duplicateWidget(null, form([["id", "3"]])));
  expect(backend.asked[1]?.body).toEqual({});
  expect(
    await duplicateWidget(
      null,
      form([
        ["id", "3"],
        ["position", "nowhere"],
      ]),
    ),
  ).toEqual({ fields: { position: errors.position } });
  expect(await duplicateWidget(null, form([]))).toEqual({ error: errors.id });
  expect(backend.asked).toHaveLength(2);
});

test("deleting sends the id and returns to the list; a refusal is shown", async () => {
  backend = fakeBackend({
    "widgets.delete": () => Response.json({ ok: true }),
  });
  const digest = await redirectedTo(() =>
    removeWidget(null, form([["id", "3"]])),
  );
  expect(digest).toMatch(/;\/admin\/widgets\?notice=deleted;/);
  expect(backend.asked[0]?.path).toBe("/api/v1/widgets/3");
  backend.restore();
  backend = fakeBackend({
    "widgets.delete": () => refusal(404, "not_found", "Not found."),
  });
  expect(await removeWidget(null, form([["id", "3"]]))).toEqual({
    error: "Not found.",
  });
  expect(await removeWidget(null, form([]))).toEqual({ error: errors.id });
});

test("the order is the widgets sorted by their numbers, for the position of the form", async () => {
  backend = fakeBackend({
    "widgets.reorder": () => Response.json({ ok: true }),
  });
  const digest = await redirectedTo(() =>
    saveOrder(
      null,
      form([
        ["position", "novedades_sidebar"],
        ["order.5", "30"],
        ["order.7", "10"],
        ["order.6", "20"],
      ]),
    ),
  );
  expect(digest).toMatch(/;\/admin\/widgets\?notice=ordered;/);
  expect(backend.asked[0]?.body).toEqual({
    position: "novedades_sidebar",
    ids: [7, 6, 5],
  });
});

test("an order that cannot be read is refused, and the backend's refusal of a changed position is shown", async () => {
  backend = fakeBackend({
    "widgets.reorder": () =>
      refusal(
        422,
        "validation",
        "List every widget of the position, once each.",
      ),
  });
  expect(await saveOrder(null, form([["order.5", "1"]]))).toEqual({
    error: errors.position,
  });
  expect(
    await saveOrder(
      null,
      form([
        ["position", "sidebar_top"],
        ["order.5", "first"],
      ]),
    ),
  ).toEqual({ error: errors.order });
  expect(
    await saveOrder(
      null,
      form([
        ["position", "sidebar_top"],
        ["order.x", "1"],
      ]),
    ),
  ).toEqual({ error: errors.id });
  expect(backend.asked).toEqual([]);
  expect(
    await saveOrder(
      null,
      form([
        ["position", "sidebar_top"],
        ["order.5", "1"],
      ]),
    ),
  ).toEqual({ error: errors.stale });
});

test("any other refusal of the order is shown as the backend gave it", async () => {
  backend = fakeBackend({
    "widgets.reorder": () => refusal(403, "forbidden", "Not allowed."),
  });
  expect(
    await saveOrder(
      null,
      form([
        ["position", "sidebar_top"],
        ["order.5", "1"],
      ]),
    ),
  ).toEqual({ error: "Not allowed." });
});
