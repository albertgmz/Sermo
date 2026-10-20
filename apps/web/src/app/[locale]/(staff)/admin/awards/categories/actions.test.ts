import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";
import { AWARD_CATEGORY } from "../../credits/test-fixtures";
import { fakeBackend, refusal } from "../../groups/test-backend";

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

let backend: ReturnType<typeof fakeBackend> | undefined;
afterEach(() => backend?.restore());
afterAll(() => {
  mock.module("next-intl/server", () => intl);
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

const { saveAwardCategory, saveAwardCategoryOrder, deleteAwardCategory } =
  await import("./actions");
const errors = messages.adminEconomy.awardCategories.errors;

test("a new category and a change send title and description, never a position", async () => {
  backend = fakeBackend({
    "awardCategories.create": () => Response.json(AWARD_CATEGORY),
    "awardCategories.update": () => Response.json(AWARD_CATEGORY),
  });
  expect(
    await redirectedTo(() =>
      saveAwardCategory(null, form({ title: "By posts", description: "" })),
    ),
  ).toMatch(/;\/admin\/awards\?notice=categoryCreated;/);
  expect(
    await redirectedTo(() =>
      saveAwardCategory(
        null,
        form({ id: "3", title: "Posts", description: "Write", position: "9" }),
      ),
    ),
  ).toMatch(/;\/admin\/awards\?notice=categorySaved;/);
  expect(
    backend.asked.map((call) => [call.operation, call.path, call.body]),
  ).toEqual([
    [
      "awardCategories.create",
      "/api/v1/awards/categories",
      { title: "By posts", description: "" },
    ],
    [
      "awardCategories.update",
      "/api/v1/awards/categories/3",
      { title: "Posts", description: "Write" },
    ],
  ]);
  expect(await saveAwardCategory(null, form({ id: "x" }))).toEqual({
    error: errors.id,
  });
});

test("a refused title is shown under its field", async () => {
  backend = fakeBackend({
    "awardCategories.create": () =>
      refusal(400, "validation", "Invalid input", [
        { path: ["title"], message: "Too long." },
      ]),
  });
  expect(
    await saveAwardCategory(null, form({ title: "x", description: "" })),
  ).toMatchObject({ fields: { title: "Too long." } });
});

test("save order sends only the numbers that changed", async () => {
  backend = fakeBackend({
    "awardCategories.update": () => Response.json(AWARD_CATEGORY),
  });
  const digest = await redirectedTo(() =>
    saveAwardCategoryOrder(
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
  expect(digest).toMatch(/notice=categoryOrdered/);
  expect(backend.asked.map((call) => call.body)).toEqual([{ position: 5 }]);
  expect(
    await saveAwardCategoryOrder(
      null,
      form({ "position:2": "x", "before:2": "1" }),
    ),
  ).toEqual({ error: errors.order });
});

test("deleting goes back to the awards with a notice; a refusal is shown", async () => {
  backend = fakeBackend({
    "awardCategories.delete": () => Response.json({ ok: true }),
  });
  expect(
    await redirectedTo(() => deleteAwardCategory(null, form({ id: "3" }))),
  ).toMatch(/;\/admin\/awards\?notice=categoryDeleted;/);
  backend.restore();
  backend = fakeBackend({
    "awardCategories.delete": () => refusal(404, "not_found", "Gone."),
  });
  expect(await deleteAwardCategory(null, form({ id: "3" }))).toEqual({
    error: "Gone.",
  });
  expect(await deleteAwardCategory(null, form({ id: "0" }))).toEqual({
    error: errors.id,
  });
});
