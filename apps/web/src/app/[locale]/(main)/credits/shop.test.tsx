import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToReadableStream } from "react-dom/server";
import { messages } from "@/i18n/messages";
import { translator, withIntl } from "@/lib/test-intl";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
// Copies: a module namespace takes the stand-in's exports once it is replaced.
const intl = { ...(await import("next-intl/server")) };
mock.module("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => translator(namespace),
}));
const nextHeaders = { ...(await import("next/headers")) };
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, toString: () => "" }),
}));
const members = { ...(await import("@/lib/sermo/members")) };
mock.module("@/lib/sermo/members", () => ({
  membersFor: async () => () => ({
    username: "ember",
    avatar: null,
    frame: null,
    nameColor: null,
  }),
}));

const { Shop } = await import("./shop");

afterAll(() => {
  mock.module("next-intl/server", () => intl);
  mock.module("@/lib/sermo/members", () => members);
  mock.module("next/headers", () => nextHeaders);
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const STAMP = "2026-01-01T00:00:00.000Z";

function item(id: number, categoryId: number, type: "group" | "bump") {
  return {
    id,
    categoryId,
    name: `Item ${id}`,
    description: "",
    icon: "",
    image: null,
    price: id * 100,
    isActive: true,
    stock: null,
    isConsumable: type === "bump",
    isGiftable: false,
    durationSeconds: null,
    effect: type === "group" ? { type, groupId: 1 } : { type },
    position: id,
    rule: { match: "all", conditions: [] },
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

const categories = [1, 2, 3].map((id) => ({
  id,
  name: `Category ${id}`,
  description: "",
  position: id,
  isActive: true,
  rule: { match: "all", conditions: [] },
  createdAt: STAMP,
  updatedAt: STAMP,
}));

// Category 1 sells the ranks (the ladder); category 2 has a group item too, and 3 a bump.
const items: Record<number, ReturnType<typeof item>[]> = {
  1: [item(1, 1, "group"), item(2, 1, "group")],
  2: [item(3, 2, "group")],
  3: [item(4, 3, "bump")],
};

function backend() {
  globalThis.fetch = (async (url: string) => {
    const { pathname } = new URL(url);
    if (pathname === "/api/v1/shop/categories") {
      return Response.json({ items: categories });
    }
    const listed = /categories\/(\d+)\/items$/.exec(pathname);
    if (listed) {
      return Response.json({
        items: items[Number(listed[1])],
        nextCursor: null,
      });
    }
    return Response.json({ items: [] });
  }) as unknown as typeof fetch;
}

async function shop(category: string, viewer: boolean) {
  backend();
  const element = await Shop({
    category,
    viewer: viewer ? { id: 1, username: "ember" } : null,
  });
  // The items are rows of the shared list, which keeps its pages in the query client.
  return new Response(
    await renderToReadableStream(
      withIntl(
        <QueryClientProvider client={new QueryClient()}>
          {element}
        </QueryClientProvider>,
      ),
    ),
  ).text();
}

const cards = (html: string) => html.split("<li ").slice(1);

test("a rank of the ladder shows a link to the upgrade page and no buy form", async () => {
  for (const viewer of [true, false]) {
    const html = await shop("1", viewer);
    const rows = cards(html);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row, String(viewer)).toContain('href="/upgrade"');
      expect(row).toContain(messages.credits.shop.ranks);
      expect(row).not.toContain("<form");
      expect(row).not.toContain(messages.credits.shop.loginToBuy);
    }
  }
});

test("a group item of another category keeps its buy form", async () => {
  const html = await shop("2", true);
  const [row] = cards(html);
  expect(row).toContain("<form");
  expect(row).not.toContain('href="/upgrade"');
});

test("an item without a group effect keeps its buy form in the ladder's neighbour", async () => {
  const html = await shop("3", true);
  expect(cards(html)[0]).toContain("<form");
});
