import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { messages } from "@/i18n/messages";
import { translator } from "@/lib/test-intl";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
const intl = await import("next-intl/server");
mock.module("next-intl/server", () => ({
  getTranslations: async (namespace: string) => translator(namespace),
}));
const nextCache = await import("next/cache");
mock.module("next/cache", () => ({ ...nextCache, revalidatePath: () => {} }));
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
      available: { accents: [], nameColors: [], frames: [], covers: [] },
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

test("a purchase goes back to the page it came from, cursor included, with the notice", async () => {
  const asked = backend();
  const to = await redirectedTo(() =>
    buyItem(5, "/credits?category=2&cursor=abc", {}, form({ quantity: "2" })),
  );
  expect(to).toBe("/credits?category=2&cursor=abc&notice=bought");
  expect(asked[0]).toMatchObject({
    method: "POST",
    path: "/api/v1/shop/items/5/buy",
  });
  expect(asked[0].body).toEqual({ quantity: 2 });
});

test("the notice replaces one the page already carried and the fragment is dropped", async () => {
  backend();
  expect(
    await redirectedTo(() =>
      buyItem(5, "/credits?tab=inventory&notice=used#top", {}, form()),
    ),
  ).toBe("/credits?tab=inventory&notice=bought");
});

test("a return path that would leave the site, or resolve to another host, is not followed", async () => {
  backend();
  for (const returnTo of [
    "/.//evil.com",
    "//evil.com",
    "/./",
    "/a/../b",
    "/%2e//evil.com",
    "https://evil.com",
    "evil.com",
    `/${String.fromCharCode(92)}evil.com`,
    undefined,
    42,
  ]) {
    const to = await redirectedTo(() =>
      buyItem(5, returnTo as string, {}, form()),
    );
    expect(to, String(returnTo)).toBe("/?notice=bought");
  }
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

test("only the frame and the name colour are worn from the shop, by a record id or none", async () => {
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

  expect(
    await redirectedTo(() => wearItem("nameColorId", 4, "/credits", {})),
  ).toBe("/credits?notice=worn");
  expect(asked[0].body).toEqual({ nameColorId: 4 });
  expect(
    await redirectedTo(() => wearItem("frameId", null, "/credits", {})),
  ).toBe("/credits?notice=removed");
  expect(asked[1].body).toEqual({ frameId: null });
});
