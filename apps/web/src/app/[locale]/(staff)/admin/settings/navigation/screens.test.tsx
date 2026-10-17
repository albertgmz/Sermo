import { afterAll, afterEach, expect, mock, test } from "bun:test";
import type { navigationList } from "@sermo/core/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import type * as z from "zod";
import { translator, withIntl } from "@/lib/test-intl";
import { viewerBody } from "@/lib/test-viewer";
import { fakeBackend } from "../../groups/test-backend";

type Entry = z.output<typeof navigationList.output>["items"][number];

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const intl = await import("next-intl/server");
// The rows read their words through the library's hook and the provider of `withIntl`, whatever
// stand-in another suite left in place for it.
const nextIntl = await import("next-intl");
const useIntl = await import("use-intl");
mock.module("next-intl", () => ({
  ...nextIntl,
  useLocale: () => "en",
  useTranslations: useIntl.useTranslations,
}));
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace, true),
}));
const { EntryList } = await import("./entry-list");
const { EntryForm } = await import("./entry-form");
const { SortLists } = await import("./sort-lists");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next-intl", () => nextIntl);
});

const entry = (over: Partial<Entry>): Entry => ({
  id: 1,
  location: "header",
  parentId: null,
  title: "Entry",
  target: "/entry",
  position: 10,
  isEnabled: true,
  audience: "everyone",
  permission: null,
  icon: null,
  iconPosition: "before",
  builtin: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

// A built-in header link with two entries under it, a custom top-level one that is switched off,
// and a footer link on its own.
const ENTRIES = [
  entry({ id: 1, title: "Forums", target: "/forums", builtin: "forums" }),
  entry({ id: 2, parentId: 1, title: "Recent", position: 20, icon: "clock" }),
  entry({ id: 3, parentId: 1, title: "Popular", position: 10 }),
  entry({ id: 4, title: "Rules", position: 30, isEnabled: false }),
  entry({ id: 5, location: "footer", title: "Contact", target: "/contact" }),
];

const serve = () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "navigation.list": () => Response.json({ items: ENTRIES }),
  });
};

test("each place lists its entries with the ones under a heading after it, each leading to its own page", async () => {
  serve();
  const html = renderToStaticMarkup(withIntl(await EntryList()));
  expect(html).toContain("Header");
  expect(html).toContain("Footer");
  for (const id of [1, 2, 3, 4, 5])
    expect(html).toContain(`href="/admin/settings/navigation/${id}"`);
  expect(html.indexOf("Forums")).toBeLessThan(html.indexOf("Recent"));
  expect(html.indexOf("Recent")).toBeLessThan(html.indexOf("Rules"));
  expect(html).toContain("Inside Forums");
  expect(html).toContain("Goes to /contact");
  // The off badge on the disabled entry, the built-in badge on the built-in one.
  expect(html).toContain("Off");
  expect(html).toContain("Built-in");
});

test("only an entry that is not built in can be deleted, from its row", async () => {
  serve();
  const html = renderToStaticMarkup(withIntl(await EntryList()));
  // The step posts the entry's id: four custom entries, one built-in.
  expect(html.match(/name="id" value="\d+"/g)).toHaveLength(4);
  expect(html).not.toContain('name="id" value="1"');
  expect(html).toContain("Delete the entry");
});

test("with no entry the list says so and offers none of the places", async () => {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(true)),
    "navigation.list": () => Response.json({ items: [] }),
  });
  const html = renderToStaticMarkup(withIntl(await EntryList()));
  expect(html).toContain("There is no navigation entry yet.");
  expect(html).not.toContain("Header");
});

const PERMISSIONS = ["admin.settings"];
const draw = async (entry?: Entry) =>
  renderToStaticMarkup(
    withIntl(
      await EntryForm({ entries: ENTRIES, permissions: PERMISSIONS, entry }),
    ),
  );

test("the add page asks for the place, target, parent and order and posts no id", async () => {
  const html = await draw();
  for (const name of [
    "location",
    "title",
    "target",
    "parentId",
    "icon",
    "iconPosition",
    "audience",
    "permission",
    "isEnabled",
    "position",
  ])
    expect(html).toContain(`name="${name}"`);
  expect(html).not.toContain(`name="id"`);
  // The built-in targets are offered.
  expect(html).toContain(`<option value="/forums">`);
  expect(html).toContain("Add entry");
});

test("the edit page posts the entry id and its own fields, filled in, and not its place, target, parent or order", async () => {
  const html = await draw(ENTRIES[3]);
  expect(html).toContain(`name="id" value="4"`);
  expect(html).toContain(`value="Rules"`);
  for (const name of [
    "icon",
    "iconPosition",
    "audience",
    "permission",
    "isEnabled",
  ])
    expect(html).toContain(`name="${name}"`);
  for (const name of ["location", "target", "parentId", "position"])
    expect(html).not.toContain(`name="${name}"`);
  // Switched off: the box is not ticked.
  expect(html).not.toMatch(/name="isEnabled"[^>]*checked/);
  expect(html).toContain("Save entry");
});

test("the sort page has one list for each place and one under each heading with entries to order", async () => {
  serve();
  const html = renderToStaticMarkup(withIntl(await SortLists()));
  // Header (Forums, Rules) and Under Forums (Recent, Popular); the footer holds a single entry.
  expect(html).toContain("Header");
  expect(html).toContain("Under Forums (Header)");
  expect(html).not.toContain("Footer");
  // Each entry number is posted under the name the order action reads.
  for (const id of [1, 4, 2, 3])
    expect(html).toContain(`name="position.${id}"`);
  expect(html).not.toContain(`name="position.5"`);
});
