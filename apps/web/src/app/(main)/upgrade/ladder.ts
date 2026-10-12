import {
  shopCategoriesList,
  shopInventory,
  shopItemsList,
} from "@sermo/core/contracts";
import { cache } from "react";
import type * as z from "zod";
import { read } from "@/lib/sermo/client";

export type Rank = z.output<typeof shopItemsList.output>["items"][number];

// How many pages of 100 are read to build the ladder and to find the rank a member holds. A shop
// or an inventory beyond it is not looked at further: ranks past the first 1000 items of their
// category are not offered, and a member whose rank is beyond the first 1000 entries of their
// inventory is shown the full price (the backend still charges the difference).
export const MAX_PAGES = 10;
const PAGE = 100;

async function itemsOf(categoryId: number): Promise<Rank[]> {
  const items: Rank[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const listing = await read(shopItemsList, {
      categoryId,
      limit: PAGE,
      cursor,
    });
    items.push(...listing.items);
    if (!listing.nextCursor) break;
    cursor = listing.nextCursor;
  }
  return items;
}

// THE SITE CONVENTION FOR PAID RANKS. A rank is a shop item with a `group` effect, and the ladder
// is the group items of ONE category: the first active category, in the backend's order, that
// holds at least one active group item, cheapest first. No category is named here, so
// administrators choose the ladder by ordering their categories. Null when no rank is offered.
// The categories after that one are not read. Kept for the request only: it depends on who asks
// (inactive items are shown to staff), so nothing of it is cached between visitors.
export const getLadder = cache(async () => {
  const { items: categories } = await read(shopCategoriesList, {});
  for (const category of categories) {
    if (!category.isActive) continue;
    const ranks = (await itemsOf(category.id))
      .filter(({ isActive, effect }) => isActive && effect.type === "group")
      .sort((a, b) => a.price - b.price || a.position - b.position);
    if (ranks.length > 0) return { category, ranks };
  }
  return null;
});

// The rank a member holds: their most expensive active group item of the ladder's category,
// which is also what the backend charges the difference from.
export async function currentRank(categoryId: number): Promise<Rank | null> {
  let best: Rank | null = null;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const held = await read(shopInventory, {
      state: "active",
      limit: PAGE,
      cursor,
    });
    for (const { item } of held.items) {
      if (
        item.effect.type === "group" &&
        item.categoryId === categoryId &&
        (!best || item.price > best.price)
      ) {
        best = item;
      }
    }
    if (!held.nextCursor) break;
    cursor = held.nextCursor;
  }
  return best;
}
