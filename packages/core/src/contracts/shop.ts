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
 * The others are stored and validated, and using the item publishes `shop.item_used`; applying
 * them is the subscriber's work:
 * - `frame`, `nameColor`: profile appearance.
 * - `threadCover`, `highlight`, `bump`: act on a thread of the member's (`shop.use` takes it).
 * - `usernameChange`: `shop.use` takes the new name.
 */
export const ShopEffect = z
  .discriminatedUnion("type", [
    z.object({
      type: z.literal("permission"),
      permission: z.string().min(1).max(100),
      value: z.number().int().min(-1).max(1_000_000_000_000).optional(),
    }),
    z.object({ type: z.literal("group"), groupId: Id }),
    z.object({ type: z.literal("frame"), frame: z.string().trim().min(1).max(100) }),
    z.object({
      type: z.literal("nameColor"),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a #rrggbb color."),
    }),
    z.object({ type: z.literal("threadCover"), cover: z.string().trim().min(1).max(200) }),
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
    "Create a shop item. A consumable has no duration and cannot have a `group` effect. A " +
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
    "permission or group item applies at once. Requires shop.buy. A gift also requires " +
    "shop.gift and a giftable item, and is refused when the recipient ignores the buyer.",
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
    "Use an item of your own inventory: publishes `shop.item_used` and, for a consumable, takes " +
    "one unit (the last unit moves the row to `used` and ends a permission it granted). " +
    "`threadCover`, `highlight` and `bump` need `threadId`, a visible thread the member started; " +
    "`usernameChange` needs `value`. `group` items, and `permission` items that are not " +
    "consumable, apply while held and cannot be used. Requires shop.buy.",
  kind: "write",
  input: z.object({
    inventoryId: Id,
    threadId: Id.optional(),
    value: z.string().trim().min(1).max(100).optional(),
  }),
  output: ShopInventoryEntry,
});

export const shopPurchases = defineContract({
  name: "shop.purchases",
  summary:
    "The purchase log, newest first, optionally of one buyer and/or one item. Requires admin.shop.",
  kind: "read",
  input: z.object({ buyerId: Id.optional(), itemId: Id.optional(), ...pageInput }),
  output: Page(ShopPurchase),
});
