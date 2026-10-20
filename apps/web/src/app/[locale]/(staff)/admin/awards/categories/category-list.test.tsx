import { afterAll, afterEach, expect, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { viewerBody } from "@/lib/test-viewer";
import { AWARD_CATEGORY } from "../../credits/test-fixtures";
import { htmlOf, mockIntl } from "../../credits/test-render";
import { fakeBackend } from "../../groups/test-backend";

const restore = await mockIntl();
const { AwardCategoryList } = await import("./category-list");
const { AwardCategoryOrder } = await import("./category-order");

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(restore);

const EMPTY = {
  ...AWARD_CATEGORY,
  id: 4,
  title: "Specials",
  position: 1,
  awardCount: 0,
};

function fake(items: unknown[]) {
  backend = fakeBackend({
    "auth.me": () => Response.json(viewerBody(false)),
    "awardCategories.list": () => Response.json({ items }),
  });
}

async function list(items: unknown[]) {
  fake(items);
  return htmlOf(await AwardCategoryList({ searchParams: Promise.resolve({}) }));
}

const text = messages.adminEconomy.awardCategories;

test("each category is a row with its edit page, its count and a delete that says what stays", async () => {
  const html = await list([AWARD_CATEGORY, EMPTY]);
  for (const id of [3, 4])
    expect(html).toContain(`href="/admin/awards/categories/${id}"`);
  expect(html).toContain("Edit By posts");
  expect(html).toContain("2 awards");
  expect(html).toContain("No awards");
  expect(html).toContain('href="/admin/awards/categories/sort"');
  expect(html).toContain('href="/admin/awards/categories/new"');
  expect(html).toContain('name="id" value="3"');
});

test("with no categories the list offers to add one and nothing to sort", async () => {
  const html = await list([]);
  expect(html).toContain(text.none);
  expect(html).toContain('href="/admin/awards/categories/new"');
  expect(html).not.toContain("/admin/awards/categories/sort");
});

test("the sort page sends what the order action reads for every category", async () => {
  fake([AWARD_CATEGORY, EMPTY]);
  const html = await htmlOf(await AwardCategoryOrder());
  for (const [id, position, title] of [
    [3, 0, "By posts"],
    [4, 1, "Specials"],
  ] as const) {
    expect(html).toContain(`name="position:${id}" value="${position}"`);
    expect(html).toContain(`name="before:${id}" value="${position}"`);
    expect(html).toContain(`name="title:${id}" value="${title}"`);
  }
});
