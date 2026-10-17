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
  },
};
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
  const html = await draw(
    NodeForm({ node: NODE, nodes: [], tabs: [TAB] }) as Promise<never>,
  );
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
  expect(html.indexOf('name="minPostCount"')).toBeLessThan(
    html.indexOf("<details"),
  );
});

test("a node under another has no tab field", async () => {
  const html = await draw(
    NodeForm({
      node: { ...NODE, parentId: 4 },
      nodes: [],
      tabs: [TAB],
    }) as Promise<never>,
  );
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
    new Set(["label", "colorId", "icon", "position", "isActive"]),
  );
  expect(fresh).toMatch(/<input[^>]*name="isActive"[^>]*checked/);
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
  expect(change).not.toMatch(/<input[^>]*name="isActive"[^>]*checked/);
});
