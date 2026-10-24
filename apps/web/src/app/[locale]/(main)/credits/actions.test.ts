import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const nextCache = await import("next/cache");
const revalidated: string[] = [];
mock.module("next/cache", () => ({
  ...nextCache,
  revalidatePath: (path: string, type?: string) => {
    revalidated.push(`${path} ${type}`);
  },
}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { buyItem, spendItem, wearItem } = await import("./actions");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
});
afterEach(() => {
  globalThis.fetch = realFetch;
  revalidated.length = 0;
});

const generic = messages.lib.errors.generic;
const STAMP = "2026-01-01T00:00:00.000Z";

function succeeded(path: string): unknown {
  if (path === "/api/v1/appearance") {
    return {
      accentId: null,
      nameColorId: null,
      frameId: null,
      coverPresetId: null,
      nameIconItemId: null,
      available: {
        accents: [],
        nameColors: [],
        frames: [],
        nameIcons: [],
        covers: [],
      },
    };
  }
  return {
    purchase: {
      id: 1,
      item: { id: 5, name: "Item" },
      buyer: { id: 1, username: "ember" },
      recipient: { id: 1, username: "ember" },
      quantity: 1,
      price: 10,
      createdAt: STAMP,
    },
    balance: 90,
    inventory: null,
  };
}

function backend(response?: () => Response) {
  const asked: { method: string; path: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    asked.push({
      method: String(init.method),
      path,
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    return response ? response() : Response.json(succeeded(path));
  }) as unknown as typeof fetch;
  return asked;
}

function form(fields: Record<string, string> = {}) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

// Where the action sent the visitor, as the text of the Location header.
async function redirectedTo(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    return String((error as { digest?: unknown }).digest).split(";")[2] ?? null;
  }
  return null;
}

// A purchase changes the item's card, the balance in the header and the inventory: they are drawn
// again where they are, in the action's answer, and the page says what was done in place. The
// page is not opened again (a navigation would put the route's placeholder over all of it).
test("a purchase is answered in place with its notice, the pages that show the balance drawn again", async () => {
  const asked = backend();
  const state = await redirectedTo(async () => {
    expect(
      await buyItem(
        5,
        "/credits?category=2&cursor=abc",
        {},
        form({ quantity: "2" }),
      ),
    ).toEqual({ notice: "bought" });
  });
  expect(state).toBeNull();
  expect(revalidated).toEqual(["/ layout"]);
  expect(asked[0]).toMatchObject({
    method: "POST",
    path: "/api/v1/shop/items/5/buy",
  });
  expect(asked[0].body).toEqual({ quantity: 2 });
});

test("a refusal is the backend's message, and nothing is redirected", async () => {
  backend(() =>
    Response.json(
      { error: { code: "conflict", message: "Not enough credits." } },
      { status: 409 },
    ),
  );
  const state = await buyItem(5, "/credits", {}, form());
  expect(state).toEqual({ error: "Not enough credits." });
});

test("a bound argument that is not a record id does nothing and is answered generically", async () => {
  const asked = backend();
  for (const id of [0, -4, 2.5, Number.NaN, "5", null, undefined, 2 ** 60]) {
    expect(
      await buyItem(id as number, "/credits", {}, form()),
      String(id),
    ).toEqual({ error: generic });
    expect(
      await spendItem(id as number, "/credits", {}, form()),
      String(id),
    ).toEqual({ error: generic });
  }
  expect(await spendItem(3, "/credits", {}, form({ thread: "abc" }))).toEqual({
    error: generic,
  });
  expect(await spendItem(3, "/credits", {}, form({ thread: "-1" }))).toEqual({
    error: generic,
  });
  expect(asked).toEqual([]);
});

test("only the frame, the name colour and the name icon are worn from the shop, by a record id or none", async () => {
  const asked = backend();
  for (const look of [
    "accentId",
    "coverPresetId",
    "available",
    "",
    undefined,
  ]) {
    expect(
      await wearItem(look as "frameId", 4, "/credits", {}),
      String(look),
    ).toEqual({ error: generic });
  }
  for (const id of [0, -1, 1.5, "4", undefined, Number.NaN]) {
    expect(
      await wearItem("frameId", id as number, "/credits", {}),
      String(id),
    ).toEqual({ error: generic });
  }
  expect(asked).toEqual([]);

  expect(await wearItem("nameColorId", 4, "/credits", {})).toEqual({
    notice: "worn",
  });
  expect(asked[0].body).toEqual({ nameColorId: 4 });
  expect(await wearItem("frameId", null, "/credits", {})).toEqual({
    notice: "removed",
  });
  expect(asked[1].body).toEqual({ frameId: null });
  expect(await wearItem("nameIconItemId", 12, "/credits", {})).toEqual({
    notice: "worn",
  });
  expect(asked[2].body).toEqual({ nameIconItemId: 12 });
  expect(await wearItem("nameIconItemId", null, "/credits", {})).toEqual({
    notice: "removed",
  });
  expect(asked[3].body).toEqual({ nameIconItemId: null });
});
