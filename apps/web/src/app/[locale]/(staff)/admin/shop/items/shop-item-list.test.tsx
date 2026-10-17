import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { viewerBody } from "@/lib/test-viewer";
import { CATEGORY, ITEM } from "../../credits/test-fixtures";
import { htmlOf, mockIntl } from "../../credits/test-render";
import { fakeBackend } from "../../groups/test-backend";

const restore = await mockIntl();
// The lookups an item's effect names are read from several backends: none is needed here.
mock.module("./lookups", () => ({
  getLookups: async () => ({
    categories: [CATEGORY, { ...CATEGORY, id: 2, name: "Ranks" }],
    frames: [],
    covers: [],
    colours: [],
    groups: null,
    permissions: null,
  }),
}));
const { ShopItemList } = await import("./shop-item-list");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(restore);

async function list(
  items: unknown[],
  nextCursor: string | null = null,
  search: Record<string, string> = {},
) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "shopItems.list": () => Response.json({ items, nextCursor }),
  });
  return htmlOf(await ShopItemList({ searchParams: Promise.resolve(search) }));
}

const text = messages.adminEconomy.items;

test("each item is a row leading to its edit page, with its effect, price and stock", async () => {
  const html = await list([
    ITEM,
    { ...ITEM, id: 6, name: "Rare", isActive: false, stock: 3 },
  ]);
  for (const id of [5, 6])
    expect(html).toContain(`href="/admin/shop/items/${id}"`);
  expect(html).toContain("Edit Rare");
  expect(html).toContain(text.effects.words.bump);
  expect(html).toContain("10 credits · stock unlimited");
  expect(html).toContain("10 credits · stock 3");
  expect(html).toContain(text.inactive);
  expect(html).toContain('name="id" value="5"');
});

test("the list is of the chosen category, and paging keeps it", async () => {
  const html = await list([ITEM], "next-page", { category: "2" });
  expect(backend?.asked.at(-1)?.path).toContain("/shop/categories/2/items");
  expect(html).toContain('<option value="2" selected');
  expect(html).toContain("category=2&amp;cursor=next-page");
});

test("with no items the list offers to add one in the category shown", async () => {
  const html = await list([], null, { category: "2" });
  expect(html).toContain(text.none);
  expect(html).toContain('href="/admin/shop/items/new?category=2"');
});
