import { afterEach, expect, mock, test } from "bun:test";

const realFetch = globalThis.fetch;

mock.module("server-only", () => ({}));
mock.module("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: () => {} }),
}));

const { currentRank, getLadder, MAX_PAGES } = await import("./ladder");

afterEach(() => {
  globalThis.fetch = realFetch;
});

const STAMP = "2026-01-01T00:00:00.000Z";

type Spec = {
  id: number;
  categoryId: number;
  price: number;
  position?: number;
  group?: boolean;
  active?: boolean;
};

function item({
  id,
  categoryId,
  price,
  position = 0,
  group = true,
  active = true,
}: Spec) {
  return {
    id,
    categoryId,
    name: `Item ${id}`,
    description: "",
    icon: "",
    image: null,
    price,
    isActive: active,
    stock: null,
    isConsumable: false,
    isGiftable: false,
    durationSeconds: null,
    effect: group ? { type: "group", groupId: 1 } : { type: "bump" },
    position,
    rule: { match: "all", conditions: [] },
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function category(id: number, isActive = true) {
  return {
    id,
    name: `Category ${id}`,
    description: "",
    position: id,
    isActive,
    rule: { match: "all", conditions: [] },
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

function entry(spec: Spec, state = "active") {
  return {
    id: spec.id * 10,
    userId: 1,
    item: item(spec),
    state,
    quantity: 1,
    expiresAt: null,
    acquiredAt: STAMP,
    updatedAt: STAMP,
  };
}

// The shop as the backend lists it: categories, the items of each one and the member's inventory
// by state, each list cut into pages of `perPage` whatever the limit asked.
function shop(model: {
  categories: ReturnType<typeof category>[];
  items?: Record<number, Spec[]>;
  inventory?: Partial<Record<string, ReturnType<typeof entry>[]>>;
  perPage?: number;
}) {
  const asked: string[] = [];
  const perPage = model.perPage ?? 100;
  const paged = (list: unknown[], cursor: string | null) => {
    const from = cursor ? Number(cursor) : 0;
    const next = from + perPage;
    return {
      items: list.slice(from, next),
      nextCursor: next < list.length ? String(next) : null,
    };
  };
  globalThis.fetch = (async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    asked.push(`${pathname}?${searchParams}`);
    if (pathname === "/api/v1/shop/categories") {
      return Response.json({ items: model.categories });
    }
    const items = /\/shop\/categories\/(\d+)\/items$/.exec(pathname);
    if (items) {
      const list = (model.items?.[Number(items[1])] ?? []).map(item);
      return Response.json(paged(list, searchParams.get("cursor")));
    }
    if (pathname === "/api/v1/shop/inventory") {
      const list = model.inventory?.[searchParams.get("state") ?? ""] ?? [];
      return Response.json(paged(list, searchParams.get("cursor")));
    }
    return Response.json(
      { error: { code: "not_found", message: "?" } },
      { status: 404 },
    );
  }) as unknown as typeof fetch;
  return asked;
}

test("a shop with no categories offers no ranks", async () => {
  shop({ categories: [] });
  expect(await getLadder()).toBeNull();
});

test("categories without an active group item are passed over, inactive ones are not read", async () => {
  const asked = shop({
    categories: [category(1), category(2, false), category(3), category(4)],
    items: {
      1: [{ id: 11, categoryId: 1, price: 50, group: false }],
      2: [{ id: 21, categoryId: 2, price: 10 }],
      3: [
        { id: 31, categoryId: 3, price: 300 },
        { id: 32, categoryId: 3, price: 100 },
        { id: 33, categoryId: 3, price: 200, active: false },
        { id: 34, categoryId: 3, price: 20, group: false },
      ],
      4: [{ id: 41, categoryId: 4, price: 5 }],
    },
  });
  const ladder = await getLadder();
  expect(ladder?.category.id).toBe(3);
  // Cheapest first; the inactive rank and the item without a group are not rungs.
  expect(ladder?.ranks.map(({ id }) => id)).toEqual([32, 31]);
  const read = asked.filter((url) => url.includes("/items"));
  expect(read.map((url) => /categories\/(\d+)/.exec(url)?.[1])).toEqual([
    "1",
    "3",
  ]);
});

test("ranks at the same price keep the order the administrators gave them", async () => {
  shop({
    categories: [category(1)],
    items: {
      1: [
        { id: 1, categoryId: 1, price: 100, position: 5 },
        { id: 2, categoryId: 1, price: 100, position: 1 },
        { id: 3, categoryId: 1, price: 50, position: 9 },
      ],
    },
  });
  expect((await getLadder())?.ranks.map(({ id }) => id)).toEqual([3, 2, 1]);
});

test("a category is read for at most the pages the cap allows", async () => {
  const many = Array.from({ length: (MAX_PAGES + 5) * 2 }, (_, index) => ({
    id: index + 1,
    categoryId: 1,
    price: index + 1,
    group: index % 2 === 0,
  }));
  const asked = shop({
    categories: [category(1)],
    items: { 1: many },
    perPage: 2,
  });
  const ladder = await getLadder();
  expect(asked.filter((url) => url.includes("/items"))).toHaveLength(MAX_PAGES);
  expect(ladder?.ranks).toHaveLength(MAX_PAGES);
});

test("the rank held is the dearest active group item of the ladder's category", async () => {
  const asked = shop({
    categories: [category(1), category(2)],
    inventory: {
      active: [
        entry({ id: 1, categoryId: 1, price: 100 }),
        // Dearer, but of another category: it is not a rung of this ladder.
        entry({ id: 2, categoryId: 2, price: 900 }),
        entry({ id: 3, categoryId: 1, price: 250 }),
        entry({ id: 4, categoryId: 1, price: 999, group: false } as Spec),
      ],
      expired: [entry({ id: 5, categoryId: 1, price: 800 }, "expired")],
    },
  });
  const held = await currentRank(1);
  expect(held?.id).toBe(3);
  // Only what is in effect is asked for.
  expect(asked.every((url) => url.includes("state=active"))).toBe(true);
});

test("an expired rank, or none, leaves the member without one", async () => {
  shop({
    categories: [category(1)],
    inventory: {
      expired: [entry({ id: 5, categoryId: 1, price: 800 }, "expired")],
    },
  });
  expect(await currentRank(1)).toBeNull();
});

test("a rank held in two categories counts in each ladder on its own", async () => {
  shop({
    categories: [category(1), category(2)],
    inventory: {
      active: [
        entry({ id: 1, categoryId: 1, price: 100 }),
        entry({ id: 2, categoryId: 2, price: 900 }),
      ],
    },
  });
  expect((await currentRank(1))?.id).toBe(1);
  expect((await currentRank(2))?.id).toBe(2);
});

test("the inventory is read for at most the pages the cap allows", async () => {
  const held = Array.from({ length: (MAX_PAGES + 5) * 2 }, (_, index) =>
    entry({ id: index + 1, categoryId: 1, price: index + 1 }),
  );
  const asked = shop({
    categories: [category(1)],
    inventory: { active: held },
    perPage: 2,
  });
  const rank = await currentRank(1);
  expect(asked).toHaveLength(MAX_PAGES);
  // The dearest entry is beyond the cap: it is not seen.
  expect(rank?.id).toBe(MAX_PAGES * 2);
});
