import * as z from "zod";
import { SHOP_INVENTORY_STATES } from "../db/schema";
import { defineContract } from "../operation";
import { Empty, Id, Ok, Page, pageInput, Timestamp, UserSummary } from "./common";
import { ImageReference } from "./images";

/**
 * What an item does. Two effects apply by themselves for as long as the item is held (a
 * non-consumable that has not expired, or a consumable with units left), through the permission
 * engine:
 * - `permission`: grants a registered permission. Yes/no permissions take no `value`; integer
 *   permissions need one (-1 = unlimited). It adds to what the member's groups grant; a `never`
 *   anywhere still denies it. A node permission is granted on every node.
 * - `group`: adds a secondary group (this is how paid ranks are sold). Never consumable.
 *
 * Two unlock a look for as long as the item is held; the member then wears it or not with
 * `appearance.set`:
 * - `frame`: an avatar frame of the picture catalog (kind `frame`).
 * - `nameColor`: a colour of the `name` palette.
 *
 * Three act on a visible thread the member started, when used with `shop.use` (which takes the
 * thread), in the same transaction that takes the unit:
 * - `threadCover`: gives the thread that cover of the picture catalog (kind `thread_cover`).
 * - `highlight`: lists show the thread highlighted for `days` more days.
 * - `bump`: the thread sorts as if it had a post now.
 *
 * And one is spent by another operation:
 * - `usernameChange`: one unit pays for one `users.changeUsername`. It is sold in units, so
 *   the item must be a consumable.
 */
export const ShopEffect = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("permission"),
      permission: z.string().min(1).max(100),
      value: z.number().int().min(-1).max(1_000_000_000_000).optional(),
    }),
    z.object({ type: z.literal("group"), groupId: Id }),
    z.object({ type: z.literal("frame"), frameId: Id }),
    z.object({ type: z.literal("nameColor"), colorId: Id }),
    z.object({ type: z.literal("threadCover"), coverId: Id }),
    z.object({ type: z.literal("highlight"), days: z.number().int().min(1).max(365) }),
    z.object({ type: z.literal("bump") }),
    z.object({ type: z.literal("usernameChange") }),
  ])
  .meta({ id: "ShopEffect" });

export const ShopCategory = z
  .object({
    id: Id,
    name: z.string(),
    description: z.string(),
    position: z.number().int(),
    isActive: z.boolean(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "ShopCategory" });

export const ShopItem = z
  .object({
    id: Id,
    categoryId: Id,
    name: z.string(),
    description: z.string(),
    /** An icon key or URL the client resolves. */
    icon: z.string(),
    /** The item's picture (images.setShopItemImage), or null. */
    image: ImageReference,
    price: z.number().int().nonnegative(),
    isActive: z.boolean(),
    /** Units left; null = unlimited. */
    stock: z.number().int().nonnegative().nullable(),
    /** Held in a quantity and used up one unit per use; any other item is bought once. */
    isConsumable: z.boolean(),
    isGiftable: z.boolean(),
    /** How long a non-consumable lasts from purchase; null = permanent. Null on consumables. */
    durationSeconds: z.number().int().positive().nullable(),
    effect: ShopEffect,
    position: z.number().int(),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "ShopItem" });

/**
 * One row per member and item. `active`: a non-consumable in effect. `unused`: a consumable with
 * units left. `used`: a consumable with none left. `expired`: a temporary item past its end (a
 * job marks it within a minute of `expiresAt`; its permission or group stops applying then).
 */
export const ShopInventoryEntry = z
  .object({
    id: Id,
    userId: Id,
    item: ShopItem,
    state: z.enum(SHOP_INVENTORY_STATES),
    /** Units left of a consumable; 1 for other items. */
    quantity: z.number().int().nonnegative(),
    expiresAt: Timestamp.nullable(),
    acquiredAt: Timestamp,
    updatedAt: Timestamp,
  })
  .meta({ id: "ShopInventoryEntry" });

export const ShopPurchase = z
  .object({
    id: Id,
    item: z.object({ id: Id, name: z.string() }),
    /** Who paid. */
    buyer: UserSummary,
    /** Who received it: the buyer, unless it was a gift. */
    recipient: UserSummary,
    quantity: z.number().int().positive(),
    /** Total paid. */
    price: z.number().int().nonnegative(),
    createdAt: Timestamp,
  })
  .meta({ id: "ShopPurchase" });

// Categories ---------------------------------------------------------------------------------

const CategoryInput = {
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500),
  position: z.number().int().min(0).max(1_000_000),
  isActive: z.boolean(),
};

export const shopCategoriesList = defineContract({
  name: "shopCategories.list",
  summary:
    "Shop categories in display order. Open to everyone; inactive categories only with admin.shop.",
  kind: "read",
  input: Empty,
  output: z.object({ items: z.array(ShopCategory) }),
});

export const shopCategoriesCreate = defineContract({
  name: "shopCategories.create",
  summary: "Create a shop category. Requires admin.shop.",
  kind: "write",
  input: z.object({
    ...CategoryInput,
    description: CategoryInput.description.default(""),
    position: CategoryInput.position.default(0),
    isActive: CategoryInput.isActive.default(true),
  }),
  output: ShopCategory,
});

export const shopCategoriesUpdate = defineContract({
  name: "shopCategories.update",
  summary:
    "Change a shop category. Items of an inactive category cannot be bought. Requires admin.shop.",
  kind: "write",
  input: z.object({
    categoryId: Id,
    name: CategoryInput.name.optional(),
    description: CategoryInput.description.optional(),
    position: CategoryInput.position.optional(),
    isActive: CategoryInput.isActive.optional(),
  }),
  output: ShopCategory,
});

export const shopCategoriesDelete = defineContract({
  name: "shopCategories.delete",
  summary: "Delete a shop category that has no items. Requires admin.shop.",
  kind: "write",
  input: z.object({ categoryId: Id }),
  output: Ok,
});

// Items --------------------------------------------------------------------------------------

const ItemInput = {
  categoryId: Id,
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000),
  icon: z.string().trim().max(200),
  price: z.number().int().min(0).max(1_000_000_000),
  isActive: z.boolean(),
  stock: z.number().int().min(0).max(1_000_000_000).nullable(),
  isConsumable: z.boolean(),
  isGiftable: z.boolean(),
  durationSeconds: z
    .number()
    .int()
    .min(60)
    .max(10 * 365 * 86_400)
    .nullable(),
  effect: ShopEffect,
  position: z.number().int().min(0).max(1_000_000),
};

export const shopItemsList = defineContract({
  name: "shopItems.list",
  summary:
    "The items of one category in display order. Open to everyone; inactive items, and the " +
    "items of an inactive category, only with admin.shop.",
  kind: "read",
  input: z.object({ categoryId: Id, ...pageInput }),
  output: Page(ShopItem),
});

export const shopItemsGet = defineContract({
  name: "shopItems.get",
  summary: "One shop item. Open to everyone; an inactive item only with admin.shop.",
  kind: "read",
  input: z.object({ itemId: Id }),
  output: ShopItem,
});

export const shopItemsCreate = defineContract({
  name: "shopItems.create",
  summary:
    "Create a shop item. A `frame`, `nameColor` or `threadCover` effect must name an entry of " +
    "its catalog that has a picture or a colour. A `usernameChange` effect needs a consumable item " +
    "(a validation error naming `isConsumable` otherwise). A consumable has no duration and cannot have a `group` effect. A " +
    "`permission` effect must name a registered permission with a value of its kind; a `group` " +
    "effect an existing group other than the guest group, ranked below the actor. Permissions " +
    "of the admin category and groups that hold admin.permissions cannot be sold. Selling a " +
    "permission or a group requires admin.permissions as well as admin.shop.",
  kind: "write",
  input: z.object({
    ...ItemInput,
    description: ItemInput.description.default(""),
    icon: ItemInput.icon.default(""),
    isActive: ItemInput.isActive.default(true),
    stock: ItemInput.stock.default(null),
    isConsumable: ItemInput.isConsumable.default(false),
    isGiftable: ItemInput.isGiftable.default(false),
    durationSeconds: ItemInput.durationSeconds.default(null),
    position: ItemInput.position.default(0),
  }),
  output: ShopItem,
});

export const shopItemsUpdate = defineContract({
  name: "shopItems.update",
  summary:
    "Change a shop item, under the rules of shopItems.create. Once an item has been bought its " +
    "effect, `isConsumable` and `durationSeconds` are fixed: members hold what they paid for. " +
    "Requires admin.shop (and admin.permissions for an item that sells a permission or a group).",
  kind: "write",
  input: z.object({
    itemId: Id,
    categoryId: ItemInput.categoryId.optional(),
    name: ItemInput.name.optional(),
    description: ItemInput.description.optional(),
    icon: ItemInput.icon.optional(),
    price: ItemInput.price.optional(),
    isActive: ItemInput.isActive.optional(),
    stock: ItemInput.stock.optional(),
    isConsumable: ItemInput.isConsumable.optional(),
    isGiftable: ItemInput.isGiftable.optional(),
    durationSeconds: ItemInput.durationSeconds.optional(),
    effect: ItemInput.effect.optional(),
    position: ItemInput.position.optional(),
  }),
  output: ShopItem,
});

export const shopItemsDelete = defineContract({
  name: "shopItems.delete",
  summary:
    "Delete a shop item that was never bought. One that was bought can only be deactivated. " +
    "Requires admin.shop.",
  kind: "write",
  input: z.object({ itemId: Id }),
  output: Ok,
});

// Buying and using ---------------------------------------------------------------------------

export const shopBuy = defineContract({
  name: "shop.buy",
  summary:
    "Buy an active item of an active category, for yourself or, with `recipientId`, as a gift. " +
    "In one transaction: charges the buyer price x quantity (a conflict when the balance or the " +
    "stock is short), adds the item to the recipient's inventory, lowers the stock and records " +
    "the purchase. A consumable adds `quantity` units; any other item takes quantity 1 and is a " +
    "conflict while the recipient holds it (after it expired it can be bought again). A " +
    "permission or group item applies at once. An item that sells a yes/no permission of global " +
    "scope the recipient already holds through something other than a shop item (a group or a " +
    "staff role, for instance) is a conflict: there is nothing to buy. Number-valued and " +
    "per-forum permissions, and a permission held only through another shop item, are always " +
    "sellable. The recipient's inventory row records what the buyer paid. Requires shop.buy. A gift also requires " +
    "shop.gift and a giftable item, and is refused when the recipient ignores the buyer or when their account was erased (conflict).",
  kind: "write",
  input: z.object({
    itemId: Id,
    quantity: z.number().int().min(1).max(100).default(1),
    recipientId: Id.optional(),
  }),
  output: z.object({
    purchase: ShopPurchase,
    /** The buyer's balance after the charge. */
    balance: z.number().int(),
    /** The buyer's inventory row; null for a gift. */
    inventory: ShopInventoryEntry.nullable(),
  }),
});

export const shopInventory = defineContract({
  name: "shop.inventory",
  summary:
    "The signed-in member's inventory in one state (`active`, `unused`, `used` or `expired`), " +
    "most recently changed first. With `userId`, another member's: requires admin.shop.",
  kind: "read",
  input: z.object({
    state: z.enum(SHOP_INVENTORY_STATES),
    userId: Id.optional(),
    ...pageInput,
  }),
  output: Page(ShopInventoryEntry),
});

export const shopUse = defineContract({
  name: "shop.use",
  summary:
    "Use an item of your own inventory on a thread: `threadCover`, `highlight` and `bump` take " +
    "`threadId`, a visible thread the member started, apply their effect to it and, for a " +
    "consumable, take one unit, all in one transaction (the last unit moves the row to `used`); " +
    "it also publishes `shop.item_used`. A consumable `permission` item is used without a " +
    "thread. Every other item cannot be used: `frame` and `nameColor` are worn with " +
    "appearance.set, `usernameChange` is spent by users.changeUsername, and `group` items and " +
    "non-consumable `permission` items apply while held. An item past its end cannot be used, " +
    "even before the expiry job has marked it. Requires shop.buy.",
  kind: "write",
  input: z.object({ inventoryId: Id, threadId: Id.optional() }),
  output: ShopInventoryEntry,
});

export const shopUpgrade = defineContract({
  name: "shop.upgrade",
  summary:
    "Move up to a better rank and pay the difference, less what the old rank is worth. The item " +
    "must be an active `group` item; the member's current rank is the most expensive `group` " +
    "item of the SAME category they hold: an active inventory row that has not run out (a rank " +
    "past its end is not held, even before the expiry job marks it). With no current rank this " +
    "is shop.buy at the full price. With one, the new rank's catalog price must exceed the old " +
    "rank's catalog price (a conflict otherwise: ranks only go up). The credit is what the " +
    "member paid for the old rank (not its catalog price today): in full for a permanent rank, " +
    "and for a timed one the paid price times the share of its duration still ahead, rounded " +
    "down. The member pays the new rank's catalog price minus the credit, never below zero. In " +
    "one transaction the member is charged (a conflict when the balance is short), the old item " +
    "leaves the inventory and its group with it, the new item is added and its group applies, " +
    "and the purchase is recorded at the price paid. The new row is worth the credit plus the " +
    "price paid, which is what a later upgrade credits. Requires shop.buy.",
  kind: "write",
  input: z.object({ itemId: Id }),
  output: z.object({
    purchase: ShopPurchase,
    /** The buyer's balance after the charge. */
    balance: z.number().int(),
    inventory: ShopInventoryEntry,
    /** The item the new one replaced, or null. */
    replacedItemId: Id.nullable(),
  }),
});

export const shopPurchases = defineContract({
  name: "shop.purchases",
  summary:
    "The purchase log, newest first, optionally of one buyer and/or one item. Requires admin.shop.",
  kind: "read",
  input: z.object({ buyerId: Id.optional(), itemId: Id.optional(), ...pageInput }),
  output: Page(ShopPurchase),
});
