import { afterAll, afterEach, expect, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { viewerBody } from "@/lib/test-viewer";
import { CATEGORY } from "../../credits/test-fixtures";
import { htmlOf, mockIntl, redirectedTo } from "../../credits/test-render";
import { fakeBackend } from "../../groups/test-backend";

const restore = await mockIntl();
const { CategoryList } = await import("./category-list");
const { CategoryOrder } = await import("./category-order");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(restore);

const SECOND = { ...CATEGORY, id: 2, name: "Ranks", position: 10 };

function fake(items: unknown[]) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "shopCategories.list": () => Response.json({ items }),
    "shopItems.list": () => Response.json({ items: [], nextCursor: null }),
  });
}

function list(items: unknown[], search: Record<string, string> = {}) {
  fake(items);
  return CategoryList({
    searchParams: Promise.resolve(search),
    addAction: <a href="/admin/shop/categories/new">Add</a>,
  });
}

const text = messages.adminEconomy.categories;

test("each category is a row with its edit page and its items", async () => {
  const html = await htmlOf(
    await list([CATEGORY, { ...SECOND, isActive: false }]),
  );
  for (const id of [1, 2])
    expect(html).toContain(`href="/admin/shop/categories/${id}"`);
  expect(html).toContain('href="/admin/shop/items?category=2"');
  expect(html).toContain("Items of Ranks");
  expect(html).toContain(text.inactive);
  expect(html).toContain('name="id" value="1"');
});

test("with no categories the list offers to add one", async () => {
  const html = await htmlOf(await list([]));
  expect(html).toContain(text.none);
  expect(html).toContain('href="/admin/shop/categories/new"');
});

test("the address the editor used to open at goes to the category's page", async () => {
  const to = await redirectedTo(async () => list([CATEGORY], { edit: "1" }));
  expect(to).toMatch(/;\/admin\/shop\/categories\/1;/);
});

test("the sort page sends what the order action reads for every category", async () => {
  fake([CATEGORY, SECOND]);
  const html = await htmlOf(await CategoryOrder());
  for (const category of [CATEGORY, SECOND]) {
    expect(html).toContain(
      `name="position:${category.id}" value="${category.position}"`,
    );
    expect(html).toContain(
      `name="before:${category.id}" value="${category.position}"`,
    );
    expect(html).toContain(
      `name="title:${category.id}" value="${category.name}"`,
    );
  }
  expect(html).toContain(text.sort.list);
});

test("the sort page of no categories says there is nothing to sort", async () => {
  fake([]);
  const html = await htmlOf(await CategoryOrder());
  expect(html).toContain(text.sort.emptyTitle);
  expect(html).not.toContain("position:");
});
