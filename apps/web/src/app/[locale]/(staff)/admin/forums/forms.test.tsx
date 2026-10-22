import { afterAll, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { translator, withIntl } from "@/lib/test-intl";

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));
const intl = await import("next-intl/server");
// The client fields read their words through the library's hook and the provider of `withIntl`,
// whatever stand-in another suite left in place for it.
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useTranslations: useIntl.useTranslations,
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
afterAll(() => {
  mock.module("next-intl", () => nextIntl);
  mock.module("next-intl/server", () => intl);
});

const { NodeCreateForm } = await import("./node-create-form");
const { NodeForm } = await import("./[id]/node-form");
const { PicturesForm } = await import("./[id]/pictures-form");
const { TabForm } = await import("./tabs/tab-form");
const { PrefixForm } = await import("./prefixes/prefix-form");

const NODE = {
  id: 9,
  parentId: null,
  type: "forum" as const,
  title: "News",
  description: "",
  icon: null,
  iconKey: null,
  cover: null,
  position: 3,
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
    countsPosts: true,
    requirePrefix: false,
  },
};
const PREFIXES = [
  {
    id: 1,
    label: "Alert",
    color: "#ff0000",
    icon: "",
    colorId: 1,
    position: 0,
    isActive: true,
  },
  {
    id: 2,
    label: "Old",
    color: "#00ff00",
    icon: "",
    colorId: 1,
    position: 1,
    isActive: false,
  },
].map((prefix) => ({
  ...prefix,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}));
const nodeForm = (
  node: Parameters<typeof NodeForm>[0]["node"],
  extra: { offered?: number[] } = {},
) =>
  NodeForm({
    node,
    nodes: [],
    tabs: [TAB],
    prefixes: PREFIXES,
    offered: new Set(extra.offered ?? []),
  }) as Promise<never>;
const TAB = {
  id: 1,
  title: "Main",
  position: 5,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

// The names of the controls a form sends.
const names = (html: string) =>
  new Set(
    [
      ...html.matchAll(/<(?:input|select|textarea)\b[^>]*\bname="([^"]+)"/g),
    ].map((match) => match[1]),
  );

const draw = async (node: Promise<React.ReactNode>) =>
  renderToStaticMarkup(withIntl(await node));

test("the node editor sends every field its action reads, the rarely changed ones in the closed card", async () => {
  const html = await draw(nodeForm(NODE));
  expect([...names(html)].sort()).toEqual(
    [
      "id",
      "title",
      "description",
      "parentId",
      "position",
      "iconKey",
      "hasTab",
      "tabId",
      "minAccountAgeDays",
      "minPostCount",
      "hasCountsPosts",
      "countsPosts",
      "hasPrefixes",
      "prefixIds",
      "requirePrefix",
      "isReadOnly",
      "requireThreadApproval",
      "requireReplyApproval",
    ].sort(),
  );
  // The three switches are inside the advanced card, which starts closed.
  const card = html.slice(html.indexOf("<details"));
  expect(card).not.toContain("<details open");
  for (const name of [
    "isReadOnly",
    "requireThreadApproval",
    "requireReplyApproval",
  ]) {
    expect(card).toContain(`name="${name}"`);
  }
  expect(html.indexOf('name="countsPosts"')).toBeLessThan(
    html.indexOf("<details"),
  );
  expect(html.indexOf('name="minPostCount"')).toBeLessThan(
    html.indexOf("<details"),
  );
});

test("a category's editor has no counting switch, so saving it leaves the flag as it is", async () => {
  const html = await draw(nodeForm({ ...NODE, type: "category" as const }));
  const sent = names(html);
  expect(sent.has("countsPosts")).toBe(false);
  expect(sent.has("hasCountsPosts")).toBe(false);
});

test("a forum's editor lists every prefix with the ones it offers ticked; a category's has none", async () => {
  const html = await draw(nodeForm(NODE, { offered: [2] }));
  const boxes = [...html.matchAll(/<input[^>]*name="prefixIds"[^>]*>/g)].map(
    (match) => match[0],
  );
  expect(boxes).toHaveLength(2);
  expect(boxes[0]).toContain('value="1"');
  expect(boxes[0]).not.toContain("checked");
  expect(boxes[1]).toContain('value="2"');
  expect(boxes[1]).toContain("checked");
  expect(html).toContain("(inactive)");
  const category = names(
    await draw(nodeForm({ ...NODE, type: "category" as const })),
  );
  for (const name of ["hasPrefixes", "prefixIds", "requirePrefix"]) {
    expect(category.has(name)).toBe(false);
  }
});

test("the prefix switch shows the forum's setting", async () => {
  const on = await draw(
    nodeForm({ ...NODE, settings: { ...NODE.settings, requirePrefix: true } }),
  );
  expect(on).toMatch(/<input[^>]*name="requirePrefix"[^>]*checked/);
  expect(await draw(nodeForm(NODE))).not.toMatch(
    /<input[^>]*name="requirePrefix"[^>]*checked/,
  );
});

test("a node under another has no tab field", async () => {
  const html = await draw(nodeForm({ ...NODE, parentId: 4 }));
  expect(names(html).has("tabId")).toBe(false);
  expect(names(html).has("hasTab")).toBe(false);
});

test("the pictures form sends the node and both pictures", async () => {
  const html = await draw(PicturesForm({ node: NODE }) as Promise<never>);
  expect(names(html)).toEqual(
    new Set(["id", "icon", "iconRemove", "cover", "coverRemove"]),
  );
});

test("a new category offers a tab only when there are tabs, a new forum never", async () => {
  const create = (type: "category" | "forum", tabs: (typeof TAB)[]) =>
    draw(NodeCreateForm({ type, nodes: [], tabs }) as Promise<never>);
  const category = await create("category", [TAB]);
  expect(names(category)).toEqual(
    new Set([
      "type",
      "title",
      "description",
      "parentId",
      "position",
      "iconKey",
      "tabId",
    ]),
  );
  expect(category).toContain('name="type" value="category"');
  expect(category).toContain("Create category");
  expect(names(await create("category", [])).has("tabId")).toBe(false);
  const forum = await create("forum", [TAB]);
  expect(names(forum).has("tabId")).toBe(false);
  expect(forum).toContain('name="type" value="forum"');
  expect(forum).toContain("Create forum");
});

test("the tab form is new without an id and a change with one", async () => {
  const fresh = await draw(TabForm({}) as Promise<never>);
  expect(names(fresh)).toEqual(new Set(["title", "position"]));
  const change = await draw(TabForm({ tab: TAB }) as Promise<never>);
  expect(names(change)).toEqual(new Set(["id", "title", "position"]));
  expect(change).toContain('value="Main"');
});

test("the prefix form sends every field, a new prefix starting active", async () => {
  const colours = [
    {
      id: 7,
      name: "Blue",
      color: "#0000ff",
      isActive: true,
    },
  ] as never;
  const fresh = await draw(PrefixForm({ colours }) as Promise<never>);
  expect(names(fresh)).toEqual(
    new Set([
      "label",
      "colorId",
      "icon",
      "position",
      "isActive",
      "offerInAllForums",
    ]),
  );
  expect(fresh).toMatch(/<input[^>]*name="isActive"[^>]*checked/);
  expect(fresh).toMatch(/<input[^>]*name="offerInAllForums"[^>]*checked/);
  const prefix = {
    id: 2,
    label: "Solved",
    colorId: 7,
    color: "#0000ff",
    icon: "tag",
    position: 4,
    isActive: false,
  } as never;
  const change = await draw(PrefixForm({ prefix, colours }) as Promise<never>);
  expect(names(change).has("id")).toBe(true);
  expect(names(change).has("offerInAllForums")).toBe(false);
  expect(change).not.toMatch(/<input[^>]*name="isActive"[^>]*checked/);
});
