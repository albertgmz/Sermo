import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { fakeBackend, refusal } from "../../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
const cache = await import("next/cache");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/cache", () => ({
  ...cache,
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

import { CATEGORY } from "../../credits/test-fixtures";

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("next/cache", () => cache);
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

const { saveCategory, saveCategoryOrder, deleteCategory } = await import(
  "./actions"
);

test("a new category may name its place; an edit never sends a position", async () => {
  backend = fakeBackend({
    "shopCategories.create": () => Response.json(CATEGORY),
    "shopCategories.update": () => Response.json(CATEGORY),
  });
  await redirectedTo(() =>
    saveCategory(null, form({ name: "A", position: "3", isActive: "on" })),
  );
  await redirectedTo(() =>
    saveCategory(null, form({ id: "2", name: "A", position: "9" })),
  );
  expect(backend.asked.map((call) => call.body)).toEqual([
    { name: "A", description: "", isActive: true, position: 3 },
    { name: "A", description: "", isActive: false },
  ]);
});

test("save order sends only the numbers that changed", async () => {
  backend = fakeBackend({
    "shopCategories.update": () => Response.json(CATEGORY),
  });
  const digest = await redirectedTo(() =>
    saveCategoryOrder(
      null,
      form({
        "position:1": "0",
        "before:1": "0",
        "position:2": "5",
        "before:2": "1",
        "position:3": "7",
        "before:3": "7",
      }),
    ),
  );
  expect(digest).toMatch(/notice=ordered/);
  expect(backend.asked.map((call) => call.body)).toEqual([{ position: 5 }]);
  expect(
    await saveCategoryOrder(null, form({ "position:2": "x", "before:2": "1" })),
  ).toEqual({
    fields: { "position:2": messages.adminEconomy.categories.errors.whole },
  });
});

test("the refusal to delete a category with items is shown", async () => {
  backend = fakeBackend({
    "shopCategories.delete": () =>
      refusal(409, "conflict", "This category still has items."),
  });
  expect(await deleteCategory(null, form({ id: "1" }))).toEqual({
    error: "This category still has items.",
  });
  expect(await deleteCategory(null, form({ id: "0" }))).toEqual({
    error: messages.adminEconomy.categories.errors.id,
  });
});
