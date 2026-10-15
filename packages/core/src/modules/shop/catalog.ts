import { isDeepStrictEqual } from "node:util";
import * as z from "zod";
import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import * as contracts from "../../contracts/shop";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { decodeCursor, encodeCursor } from "../../pagination";
import {
  can,
  currentActor,
  memberStanding,
  requirePermission,
  validatePurchasedGrant,
} from "../../permissions";
import { assertRule } from "../../shared/criteria";
import { catalogImageById, paletteColorById } from "../appearance";
import { releaseFile } from "../images/attach";
import { allowedBy } from "./audience";
import {
  type CategoryRow,
  category,
  categoryValue,
  type Effect,
  type Item,
  type ItemRow,
  item,
  itemsSql,
  itemValue,
  shopSql,
  statement,
} from "./data";

/**
 * Inside the write transaction: the shop manager as committed now (the request's actor was
 * resolved before it opened). Every later decision of the operation uses the result.
 */
function managerNow(ctx: Ctx, actor: Actor): Actor {
  const current = currentActor(ctx, actor);
  requirePermission(ctx, current, "admin.shop");
  return current;
}
function grantPermissions(ctx: Ctx, actor: Actor, effect: Effect): void {
  if (effect.type === "permission" || effect.type === "group")
    requirePermission(ctx, actor, "admin.permissions");
}
function assertGrantRank(ctx: Ctx, actor: Actor, effect: Effect): void {
  if (effect.type !== "group") return;
  const group = statement<{ rank: number }>(ctx, shopSql.group).get(effect.groupId);
  if (!group) throw new NotFoundError();
  if (group.rank >= memberStanding(ctx, actor).maxRank) throw new ForbiddenError();
}
/**
 * A `frame`, `nameColor` or `threadCover` effect names an entry of its catalog. The entry must
 * exist and be of the right kind; one that cannot be shown yet (no picture, no placement) or is
 * inactive is allowed only on an item that is not for sale.
 */
function assertCatalogEntry(ctx: Ctx, effect: Effect, forSale: boolean): void {
  if (effect.type === "nameColor") {
    const color = paletteColorById(ctx, effect.colorId);
    if (color?.kind !== "name")
      throw new ValidationError("The colour must be an entry of the name palette.");
    if (forSale && !color.isActive) throw new ValidationError("The colour is not active.");
    return;
  }
  if (effect.type !== "frame" && effect.type !== "threadCover") return;
  const id = effect.type === "frame" ? effect.frameId : effect.coverId;
  const kind = effect.type === "frame" ? "frame" : "thread_cover";
  const entry = catalogImageById(ctx, id);
  if (entry?.kind !== kind)
    throw new ValidationError(`The picture must be an entry of the ${kind} catalog.`);
  if (!forSale) return;
  if (!entry.image) throw new ValidationError("The catalog entry has no picture yet.");
  if (kind === "frame" && !entry.placement)
    throw new ValidationError("The frame has no placement yet.");
  if (!entry.isActive) throw new ValidationError("The catalog entry is not active.");
}
function validateItem(
  ctx: Ctx,
  actor: Actor,
  value: Pick<Item, "effect" | "isConsumable" | "durationSeconds" | "isActive" | "rule">,
  forSale = value.isActive,
): void {
  assertRule(ctx, value.rule, "cheap");
  if (value.isConsumable && (value.durationSeconds !== null || value.effect.type === "group"))
    throw new ValidationError("Consumables cannot have a duration or grant a group.");
  const effect = value.effect;
  if (effect.type === "usernameChange" && !value.isConsumable)
    throw new ValidationError("isConsumable: a username change is sold in units.");
  if (effect.type === "promote" && !value.isConsumable)
    throw new ValidationError("isConsumable: a promotion is sold in units.");
  if (effect.type === "nameIcon" && value.isConsumable)
    throw new ValidationError("isConsumable: a name icon is worn, not used up.");
  grantPermissions(ctx, actor, effect);
  if (effect.type === "permission" || effect.type === "group") validatePurchasedGrant(ctx, effect);
  assertGrantRank(ctx, actor, effect);
  assertCatalogEntry(ctx, effect, forSale);
}

export const categoriesList = implement(
  contracts.shopCategoriesList,
  (ctx, actor) => {
    const admin = can(ctx, actor, "admin.shop");
    const rows = statement<CategoryRow>(ctx, shopSql.categories)
      .all()
      .filter((row) => admin || row.is_active);
    return {
      items: (admin ? rows : allowedBy(ctx, actor, rows)).map((row) => categoryValue(row, admin)),
    };
  },
  { public: "The active shop catalog is visible to everyone." },
);

export const categoriesCreate = implement(contracts.shopCategoriesCreate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.shop");
  return writeTx(ctx, () => {
    managerNow(ctx, actor);
    assertRule(ctx, input.rule, "cheap");
    return categoryValue(
      statement<CategoryRow>(
        ctx,
        "INSERT INTO shop_categories (name, description, position, is_active, rule, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) RETURNING *",
      ).get(
        input.name,
        input.description,
        input.position,
        Number(input.isActive),
        JSON.stringify(input.rule),
        ctx.now(),
      )!,
      true,
    );
  });
});
export const categoriesUpdate = implement(contracts.shopCategoriesUpdate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.shop");
  return writeTx(ctx, () => {
    managerNow(ctx, actor);
    const row = category(ctx, input.categoryId);
    if (input.rule) assertRule(ctx, input.rule, "cheap");
    return categoryValue(
      statement<CategoryRow>(
        ctx,
        "UPDATE shop_categories SET name = ?1, description = ?2, position = ?3, is_active = ?4, rule = ?5, updated_at = ?6 WHERE id = ?7 RETURNING *",
      ).get(
        input.name ?? row.name,
        input.description ?? row.description,
        input.position ?? row.position,
        Number(input.isActive ?? !!row.is_active),
        input.rule ? JSON.stringify(input.rule) : row.rule,
        ctx.now(),
        row.id,
      )!,
      true,
    );
  });
});
export const categoriesDelete = implement(contracts.shopCategoriesDelete, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.shop");
  return writeTx(ctx, () => {
    managerNow(ctx, actor);
    category(ctx, input.categoryId);
    if (statement(ctx, shopSql.categoryItems).get(input.categoryId))
      throw new ConflictError("This category still has items.");
    statement(ctx, "DELETE FROM shop_categories WHERE id = ?1").run(input.categoryId);
    return { ok: true as const };
  });
});

export const itemsList = implement(
  contracts.shopItemsList,
  (ctx, actor, input) => {
    const cursor = input.cursor
      ? decodeCursor(
          input.cursor,
          z.tuple([z.number().int().nonnegative(), z.number().int().positive()]),
        )
      : [-1, 0];
    const admin = can(ctx, actor, "admin.shop");
    const parent = statement<CategoryRow>(ctx, shopSql.category).get(input.categoryId);
    if (!parent || (!admin && !parent.is_active)) return { items: [], nextCursor: null };
    if (!admin && allowedBy(ctx, actor, [parent]).length === 0)
      return { items: [], nextCursor: null };
    // Rows the viewer's rule hides are skipped, so keep reading until the page is full: a page's worth
    // first, then growing batches when many rows were hidden.
    let size = input.limit + 1;
    const rows: ItemRow[] = [];
    let after = cursor;
    for (;;) {
      const batch = statement<ItemRow>(ctx, itemsSql(admin)).all(
        input.categoryId,
        after[0]!,
        after[1]!,
        size,
      );
      rows.push(...(admin ? batch : allowedBy(ctx, actor, batch)));
      const last = batch.at(-1);
      if (batch.length < size || rows.length > input.limit || !last) break;
      after = [last.position, last.id];
      size = Math.min(size * 4, 400);
    }
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => itemValue(ctx, row, admin)),
      nextCursor: rows.length > input.limit && last ? encodeCursor([last.position, last.id]) : null,
    };
  },
  { public: "The active shop catalog is visible to everyone." },
);
export const itemsGet = implement(
  contracts.shopItemsGet,
  (ctx, actor, input) => {
    const row = item(ctx, input.itemId);
    const admin = can(ctx, actor, "admin.shop");
    if (!admin) {
      const parent = category(ctx, row.category_id);
      if (!row.is_active || !parent.is_active || allowedBy(ctx, actor, [parent, row]).length < 2)
        throw new NotFoundError();
    }
    return itemValue(ctx, row, admin);
  },
  { public: "The active shop catalog is visible to everyone." },
);
export const itemsCreate = implement(contracts.shopItemsCreate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.shop");
  return writeTx(ctx, () => {
    const current = managerNow(ctx, actor);
    validateItem(ctx, current, input, true);
    category(ctx, input.categoryId);
    return itemValue(
      ctx,
      statement<ItemRow>(
        ctx,
        "INSERT INTO shop_items (category_id, name, description, icon, price, is_active, stock, is_consumable, is_giftable, duration_seconds, effect, position, rule, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14) RETURNING *",
      ).get(
        input.categoryId,
        input.name,
        input.description,
        input.icon,
        input.price,
        Number(input.isActive),
        input.stock,
        Number(input.isConsumable),
        Number(input.isGiftable),
        input.durationSeconds,
        JSON.stringify(input.effect),
        input.position,
        JSON.stringify(input.rule),
        ctx.now(),
      )!,
      true,
    );
  });
});
export const itemsUpdate = implement(contracts.shopItemsUpdate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.shop");
  return writeTx(ctx, () => {
    const current = managerNow(ctx, actor);
    const previous = itemValue(ctx, item(ctx, input.itemId), true);
    grantPermissions(ctx, current, previous.effect);
    assertGrantRank(ctx, current, previous.effect);
    const value = {
      ...previous,
      ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
    } as Item;
    grantPermissions(ctx, current, value.effect);
    if (
      (!isDeepStrictEqual(previous.effect, value.effect) ||
        previous.isConsumable !== value.isConsumable ||
        previous.durationSeconds !== value.durationSeconds) &&
      statement(ctx, shopSql.bought).get(previous.id)
    )
      throw new ConflictError("A purchased item's effect, kind and duration cannot change.");
    // Only a new effect, or an item put on sale, needs an entry that can be shown now: an item
    // that is not for sale may wait for its picture, and one whose entry was deactivated since
    // stays as it is.
    validateItem(
      ctx,
      current,
      value,
      !isDeepStrictEqual(previous.effect, value.effect) || (value.isActive && !previous.isActive),
    );
    category(ctx, value.categoryId);
    return itemValue(
      ctx,
      statement<ItemRow>(
        ctx,
        "UPDATE shop_items SET category_id = ?1, name = ?2, description = ?3, icon = ?4, price = ?5, is_active = ?6, stock = ?7, is_consumable = ?8, is_giftable = ?9, duration_seconds = ?10, effect = ?11, position = ?12, rule = ?13, updated_at = ?14 WHERE id = ?15 RETURNING *",
      ).get(
        value.categoryId,
        value.name,
        value.description,
        value.icon,
        value.price,
        Number(value.isActive),
        value.stock,
        Number(value.isConsumable),
        Number(value.isGiftable),
        value.durationSeconds,
        JSON.stringify(value.effect),
        value.position,
        JSON.stringify(value.rule),
        ctx.now(),
        previous.id,
      )!,
      true,
    );
  });
});
export const itemsDelete = implement(contracts.shopItemsDelete, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.shop");
  return writeTx(ctx, () => {
    managerNow(ctx, actor);
    const row = item(ctx, input.itemId);
    if (statement(ctx, shopSql.bought).get(row.id))
      throw new ConflictError("A purchased item can only be deactivated.");
    statement(ctx, "DELETE FROM shop_items WHERE id = ?1").run(row.id);
    if (row.image_file_id !== null) releaseFile(ctx, row.image_file_id);
    return { ok: true as const };
  });
});
