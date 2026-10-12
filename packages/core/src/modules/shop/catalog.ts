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
function validateItem(
  ctx: Ctx,
  actor: Actor,
  value: Pick<Item, "effect" | "isConsumable" | "durationSeconds">,
): void {
  if (value.isConsumable && (value.durationSeconds !== null || value.effect.type === "group"))
    throw new ValidationError("Consumables cannot have a duration or grant a group.");
  const effect = value.effect;
  grantPermissions(ctx, actor, effect);
  if (effect.type === "permission" || effect.type === "group") validatePurchasedGrant(ctx, effect);
  assertGrantRank(ctx, actor, effect);
}

export const categoriesList = implement(
  contracts.shopCategoriesList,
  (ctx, actor) => {
    const admin = can(ctx, actor, "admin.shop");
    return {
      items: statement<CategoryRow>(ctx, shopSql.categories)
        .all()
        .filter((row) => admin || row.is_active)
        .map(categoryValue),
    };
  },
  { public: "The active shop catalog is visible to everyone." },
);

export const categoriesCreate = implement(contracts.shopCategoriesCreate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.shop");
  return writeTx(ctx, () => {
    managerNow(ctx, actor);
    return categoryValue(
      statement<CategoryRow>(
        ctx,
        "INSERT INTO shop_categories (name, description, position, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5) RETURNING *",
      ).get(input.name, input.description, input.position, Number(input.isActive), ctx.now())!,
    );
  });
});
export const categoriesUpdate = implement(contracts.shopCategoriesUpdate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.shop");
  return writeTx(ctx, () => {
    managerNow(ctx, actor);
    const row = category(ctx, input.categoryId);
    return categoryValue(
      statement<CategoryRow>(
        ctx,
        "UPDATE shop_categories SET name = ?1, description = ?2, position = ?3, is_active = ?4, updated_at = ?5 WHERE id = ?6 RETURNING *",
      ).get(
        input.name ?? row.name,
        input.description ?? row.description,
        input.position ?? row.position,
        Number(input.isActive ?? !!row.is_active),
        ctx.now(),
        row.id,
      )!,
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
    const rows = statement<ItemRow>(ctx, itemsSql(admin)).all(
      input.categoryId,
      cursor[0]!,
      cursor[1]!,
      input.limit + 1,
    );
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      items: page.map(itemValue),
      nextCursor: rows.length > input.limit && last ? encodeCursor([last.position, last.id]) : null,
    };
  },
  { public: "The active shop catalog is visible to everyone." },
);
export const itemsGet = implement(
  contracts.shopItemsGet,
  (ctx, actor, input) => {
    const row = item(ctx, input.itemId);
    if (
      !can(ctx, actor, "admin.shop") &&
      (!row.is_active || !category(ctx, row.category_id).is_active)
    )
      throw new NotFoundError();
    return itemValue(row);
  },
  { public: "The active shop catalog is visible to everyone." },
);
export const itemsCreate = implement(contracts.shopItemsCreate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.shop");
  return writeTx(ctx, () => {
    const current = managerNow(ctx, actor);
    validateItem(ctx, current, input);
    category(ctx, input.categoryId);
    return itemValue(
      statement<ItemRow>(
        ctx,
        "INSERT INTO shop_items (category_id, name, description, icon, price, is_active, stock, is_consumable, is_giftable, duration_seconds, effect, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13) RETURNING *",
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
        ctx.now(),
      )!,
    );
  });
});
export const itemsUpdate = implement(contracts.shopItemsUpdate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.shop");
  return writeTx(ctx, () => {
    const current = managerNow(ctx, actor);
    const previous = itemValue(item(ctx, input.itemId));
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
    validateItem(ctx, current, value);
    category(ctx, value.categoryId);
    return itemValue(
      statement<ItemRow>(
        ctx,
        "UPDATE shop_items SET category_id = ?1, name = ?2, description = ?3, icon = ?4, price = ?5, is_active = ?6, stock = ?7, is_consumable = ?8, is_giftable = ?9, duration_seconds = ?10, effect = ?11, position = ?12, updated_at = ?13 WHERE id = ?14 RETURNING *",
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
        ctx.now(),
        previous.id,
      )!,
    );
  });
});
export const itemsDelete = implement(contracts.shopItemsDelete, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.shop");
  return writeTx(ctx, () => {
    managerNow(ctx, actor);
    const value = itemValue(item(ctx, input.itemId));
    if (statement(ctx, shopSql.bought).get(value.id))
      throw new ConflictError("A purchased item can only be deactivated.");
    statement(ctx, "DELETE FROM shop_items WHERE id = ?1").run(value.id);
    return { ok: true as const };
  });
});
