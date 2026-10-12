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

import { ITEM } from "../../credits/test-fixtures";

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

const { saveItem, deleteItem } = await import("./actions");

const base = {
  categoryId: "1",
  name: "Item",
  price: "10",
  position: "0",
  isActive: "on",
};

test("each effect type sends exactly the fields it needs", async () => {
  backend = fakeBackend({ "shopItems.create": () => Response.json(ITEM) });
  const effects: [Record<string, string>, unknown][] = [
    [
      { effectType: "frame", frameId: "2" },
      { type: "frame", frameId: 2 },
    ],
    [
      { effectType: "nameColor", colorId: "3" },
      { type: "nameColor", colorId: 3 },
    ],
    [
      { effectType: "threadCover", coverId: "4" },
      { type: "threadCover", coverId: 4 },
    ],
    [
      { effectType: "group", groupId: "6" },
      { type: "group", groupId: 6 },
    ],
    [
      { effectType: "highlight", days: "3" },
      { type: "highlight", days: 3 },
    ],
    [{ effectType: "bump" }, { type: "bump" }],
    [
      {
        effectType: "permission",
        permission: "attachment.storageQuota",
        permissionValue: "5",
      },
      { type: "permission", permission: "attachment.storageQuota", value: 5 },
    ],
    [
      { effectType: "permission", permission: "profile.view" },
      { type: "permission", permission: "profile.view" },
    ],
  ];
  for (const [fields] of effects) {
    await redirectedTo(() => saveItem(null, form({ ...base, ...fields })));
  }
  expect(
    backend.asked.map((call) => (call.body as { effect: unknown }).effect),
  ).toEqual(effects.map(([, effect]) => effect));
});

test("a consumable item sends no duration, any other its duration in seconds", async () => {
  backend = fakeBackend({ "shopItems.create": () => Response.json(ITEM) });
  await redirectedTo(() =>
    saveItem(
      null,
      form({
        ...base,
        effectType: "usernameChange",
        isConsumable: "on",
        durationAmount: "3",
        durationUnit: "days",
        stock: "",
      }),
    ),
  );
  await redirectedTo(() =>
    saveItem(
      null,
      form({
        ...base,
        effectType: "bump",
        durationAmount: "2",
        durationUnit: "hours",
        stock: "4",
        isGiftable: "on",
      }),
    ),
  );
  const [first, second] = backend.asked.map(
    (call) => call.body as Record<string, unknown>,
  );
  expect(first).toMatchObject({
    isConsumable: true,
    durationSeconds: null,
    stock: null,
    effect: { type: "usernameChange" },
  });
  expect(second).toMatchObject({
    isConsumable: false,
    durationSeconds: 7200,
    stock: 4,
    isGiftable: true,
  });
});

test("a picture is attached after the item is saved, and removed on request", async () => {
  backend = fakeBackend({
    "shopItems.create": () => Response.json(ITEM),
    "shopItems.update": () => Response.json(ITEM),
    "images.setShopItemImage": () => Response.json(null),
  });
  await redirectedTo(() =>
    saveItem(null, form({ ...base, effectType: "bump", fileId: "12" })),
  );
  await redirectedTo(() =>
    saveItem(
      null,
      form({ ...base, id: "5", effectType: "bump", fileIdRemove: "1" }),
    ),
  );
  expect(
    backend.asked
      .filter((call) => call.operation === "images.setShopItemImage")
      .map((call) => call.body),
  ).toEqual([{ fileId: 12 }, { fileId: null }]);
});

test("an incomplete effect or a bad number is refused; the backend refusal is shown", async () => {
  backend = fakeBackend({
    "shopItems.create": () =>
      refusal(422, "validation", "A username change needs a consumable item."),
  });
  const e = messages.adminEconomy.items.errors;
  expect(await saveItem(null, form({ ...base, effectType: "frame" }))).toEqual({
    fields: { effect: e.effect },
  });
  expect(
    await saveItem(null, form({ ...base, effectType: "bump", price: "x" })),
  ).toEqual({ fields: { price: e.number } });
  expect(backend.asked).toEqual([]);
  expect(
    await saveItem(null, form({ ...base, effectType: "usernameChange" })),
  ).toEqual({ error: "A username change needs a consumable item." });
});

test("deleting a bought item shows the backend refusal", async () => {
  backend = fakeBackend({
    "shopItems.delete": () => refusal(409, "conflict", "It was bought."),
  });
  expect(await deleteItem(null, form({ id: "5" }))).toEqual({
    error: "It was bought.",
  });
});
