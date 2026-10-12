import { enqueueJob, registerJobHandler, registerShopJobs, runDueJobs } from "@sermo/core";
import { writeTx } from "../../packages/core/src/db/tx";
import type { Effect, Item } from "../../packages/core/src/modules/shop/data";
import { expireShopBatch } from "../../packages/core/src/modules/shop/expiry";
import { grantPurchased } from "../../packages/core/src/permissions";
import { moveCredits } from "../../packages/core/src/shared/credits";
import type { BenchEnv, Scenario } from "../harness";

function response<T>(body: unknown): T {
  return JSON.parse(String(body)) as T;
}
async function category(env: BenchEnv): Promise<number> {
  return response<{ id: number }>(
    await env.call("shopCategories.create", env.actors.admin, { name: "Benchmark catalog" }),
  ).id;
}
async function item(env: BenchEnv, categoryId: number, fields: Partial<Item> = {}): Promise<Item> {
  return response<Item>(
    await env.call("shopItems.create", env.actors.admin, {
      categoryId,
      name: "Benchmark item",
      price: 1,
      effect: { type: "frame", frame: "gold" },
      ...fields,
    }),
  );
}
function count(): number {
  const index = process.argv.indexOf("--iterations");
  const requested = Number(
    index >= 0
      ? process.argv[index + 1]
      : process.argv.find((arg) => arg.startsWith("--iterations="))?.split("=")[1],
  );
  return Math.max(100, requested || 100) + 20;
}
function fund(env: BenchEnv, userId: number): void {
  writeTx(env.ctx, () => moveCredits(env.ctx, [{ userId, amount: 1_000_000, type: "adjustment" }]));
}
function catalogWrite(operation: "create" | "update" | "delete", items: boolean): Scenario {
  let categoryId = 0;
  let itemId = 0;
  let ids: number[] = [];
  const namespace = items ? "shopItems" : "shopCategories";
  return {
    name: `${namespace}.${operation}`,
    kind: "write",
    async setup(env) {
      categoryId = await category(env);
      ids = [];
      if (items && operation !== "create") itemId = (await item(env, categoryId)).id;
      if (operation === "delete")
        for (let n = 0; n < count(); n++)
          ids.push(items ? (await item(env, categoryId)).id : await category(env));
    },
    run(env) {
      if (operation === "create")
        return env.call(
          `${namespace}.create`,
          env.actors.admin,
          items
            ? {
                categoryId,
                name: "Created item",
                price: 1,
                effect: { type: "frame", frame: "silver" },
              }
            : { name: "Created category" },
        );
      const id = operation === "delete" ? ids.shift()! : items ? itemId : categoryId;
      if (!id) throw new Error("Shop benchmark fixtures exhausted.");
      const input = items ? { itemId: id } : { categoryId: id };
      if (operation === "delete") return env.call(`${namespace}.delete`, env.actors.admin, input);
      const table = items ? "shop_items" : "shop_categories";
      const active = env.ctx.sqlite
        .prepare<{ is_active: number }, [number]>(`SELECT is_active FROM ${table} WHERE id = ?1`)
        .get(id)!.is_active;
      return env.call(`${namespace}.update`, env.actors.admin, { ...input, isActive: !active });
    },
  };
}

function buying(
  kind: "consumable" | "permanent" | "permission" | "group" | "gift" | "renew",
): Scenario {
  let ids: number[] = [];
  let sharedItem = 0;
  let buyerId = 0;
  return {
    name: `shop.buy ${kind}`,
    kind: "write",
    async setup(env) {
      ids = [];
      buyerId = kind === "gift" ? env.meta.adminId : env.meta.economy.richUserIds[0]!;
      fund(env, buyerId);
      await env.authHeader(env.actors.user(buyerId));
      const categoryId = await category(env);
      const fields: Partial<Item> =
        kind === "permission"
          ? { effect: { type: "permission", permission: "profilePost.viewDeleted" } }
          : kind === "group"
            ? { effect: { type: "group", groupId: env.meta.customGroupIds[0]! } }
            : kind === "renew"
              ? { durationSeconds: 60 }
              : {};
      if (kind === "consumable" || kind === "gift")
        sharedItem = (
          await item(env, categoryId, {
            isConsumable: true,
            isGiftable: true,
            stock: count() + 100,
          })
        ).id;
      else for (let n = 0; n < count(); n++) ids.push((await item(env, categoryId, fields)).id);
      if (kind === "renew")
        writeTx(env.ctx, () => {
          const insert = env.ctx.sqlite.prepare(
            "INSERT INTO shop_inventory (user_id, item_id, state, quantity, expires_at, acquired_at, updated_at) VALUES (?1, ?2, 'expired', 1, 0, 0, 0)",
          );
          for (const id of ids) insert.run(buyerId, id);
        });
    },
    run(env) {
      const itemId = kind === "consumable" || kind === "gift" ? sharedItem : ids.shift();
      if (!itemId) throw new Error("Shop purchase fixtures exhausted.");
      return env.call("shop.buy", env.actors.user(buyerId), {
        itemId,
        ...(kind === "gift" ? { recipientId: env.meta.economy.richUserIds[1]! } : {}),
      });
    },
  };
}

function using(kind: "cosmetic" | "consumable" | "permission" | "thread"): Scenario {
  let inventoryId = 0;
  let threadId: number | undefined;
  let userId = 0;
  let inventoryIds: number[] = [];
  return {
    name: `shop.use ${kind}`,
    kind: "write",
    async setup(env) {
      threadId = undefined;
      inventoryIds = [];
      userId = env.meta.economy.richUserIds[0]!;
      if (kind === "thread") {
        threadId = env.meta.threadIds[0]!;
        userId = env.ctx.sqlite
          .prepare<{ user_id: number }, [number]>("SELECT user_id FROM threads WHERE id = ?1")
          .get(threadId)!.user_id;
      }
      fund(env, userId);
      await env.authHeader(env.actors.user(userId));
      const categoryId = await category(env);
      const effect: Effect =
        kind === "thread"
          ? { type: "bump" }
          : kind === "permission"
            ? { type: "permission", permission: "profilePost.viewDeleted" }
            : { type: "frame", frame: "gold" };
      if (kind === "permission") {
        // Each measured use consumes a last unit and exercises grant revocation.
        for (let n = 0; n < count(); n++) {
          const ownItem = await item(env, categoryId, { isConsumable: true, effect });
          const result = response<{ inventory: { id: number } }>(
            await env.call("shop.buy", env.actors.user(userId), {
              itemId: ownItem.id,
            }),
          );
          inventoryIds.push(result.inventory.id);
        }
      } else {
        const ownItem = await item(env, categoryId, { isConsumable: kind !== "cosmetic", effect });
        let units = kind === "cosmetic" ? 1 : count();
        while (units > 0) {
          const quantity = Math.min(units, 100);
          const result = response<{ inventory: { id: number } }>(
            await env.call("shop.buy", env.actors.user(userId), {
              itemId: ownItem.id,
              quantity,
            }),
          );
          inventoryId = result.inventory.id;
          units -= quantity;
        }
      }
    },
    run(env) {
      const id = kind === "permission" ? inventoryIds.shift() : inventoryId;
      if (!id) throw new Error("Shop use fixtures exhausted.");
      return env.call("shop.use", env.actors.user(userId), {
        inventoryId: id,
        ...(threadId === undefined ? {} : { threadId }),
      });
    },
  };
}

function expiry(): Scenario {
  let active = false;
  let background: Promise<void> | null = null;
  let maxChunkMs = 0;
  let batches = 0;
  let overlappingReads = 0;
  return {
    name: "shop.inventory during shop.expire",
    kind: "read",
    async setup(env) {
      const categoryId = await category(env);
      const temporary = await item(env, categoryId, {
        price: 0,
        durationSeconds: 60,
        effect: { type: "permission", permission: "profilePost.viewDeleted" },
      });
      const inventoryIds: number[] = [];
      for (const userId of env.meta.memberIds) {
        const purchase = response<{ inventory: { id: number } }>(
          await env.call("shop.buy", env.actors.user(userId), {
            itemId: temporary.id,
          }),
        );
        inventoryIds.push(purchase.inventory.id);
      }
      // Only this scenario's rows become due; seeded temporary items remain untouched.
      writeTx(env.ctx, () =>
        env.ctx.sqlite
          .prepare("UPDATE shop_inventory SET expires_at = 0 WHERE item_id = ?1")
          .run(temporary.id),
      );
      registerShopJobs(env.ctx);
      maxChunkMs = 0;
      batches = 0;
      overlappingReads = 0;
      registerJobHandler(env.ctx, "shop.expire", async (context) => {
        while (true) {
          const start = performance.now();
          const processed = expireShopBatch(context);
          maxChunkMs = Math.max(maxChunkMs, performance.now() - start);
          if (!processed) break;
          batches++;
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      });
      active = true;
      background = (async () => {
        while (active) {
          // Replenish this scenario's expired rows in a bounded transaction so warmup does not
          // exhaust the work before measured reads start. No seeded inventory is changed.
          writeTx(env.ctx, () => {
            const rows = env.ctx.sqlite
              .prepare<{ id: number; user_id: number }, [string]>(
                "SELECT id, user_id FROM shop_inventory WHERE id IN (SELECT value FROM json_each(?1)) AND state = 'expired' LIMIT 10",
              )
              .all(JSON.stringify(inventoryIds));
            for (const row of rows) {
              env.ctx.sqlite
                .prepare(
                  "UPDATE shop_inventory SET state = 'active', expires_at = 0 WHERE id = ?1 AND state = 'expired'",
                )
                .run(row.id);
              grantPurchased(env.ctx, row.user_id, row.id, {
                type: "permission",
                permission: "profilePost.viewDeleted",
              });
            }
          });
          enqueueJob(env.ctx, "shop.expire", {}, { uniqueKey: "shop.expire" });
          await runDueJobs(env.ctx, { limit: 1 });
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      })();
    },
    async run(env) {
      const before = batches;
      await new Promise<void>((resolve) => setImmediate(resolve));
      const result = await env.call(
        "shop.inventory",
        env.actors.user(env.meta.economy.inventoryHeavyUserIds[0]!),
        { state: "active", limit: 20 },
      );
      if (batches > before) overlappingReads++;
      return result;
    },
    async teardown(env) {
      active = false;
      await background;
      background = null;
      registerShopJobs(env.ctx);
      console.log(`Shop expiry maximum transaction batch: ${maxChunkMs.toFixed(2)} ms`);
      if (overlappingReads === 0) throw new Error("Shop expiry did not overlap inventory reads.");
      if (maxChunkMs > 50) throw new Error("Shop expiry transaction exceeded the write budget.");
    },
  };
}

export const scenarios: Scenario[] = [
  {
    name: "shopCategories.list guest",
    kind: "read",
    run: (env) => env.call("shopCategories.list", env.actors.guest, {}),
  },
  {
    name: "shopCategories.list admin",
    kind: "read",
    run: (env) => env.call("shopCategories.list", env.actors.admin, {}),
  },
  {
    name: "shopItems.list guest",
    kind: "read",
    run: (env) =>
      env.call("shopItems.list", env.actors.guest, {
        categoryId: env.meta.economy.categoryIds[0]!,
        limit: 20,
      }),
  },
  {
    name: "shopItems.get guest",
    kind: "read",
    run: (env) =>
      env.call("shopItems.get", env.actors.guest, {
        itemId: env.meta.economy.itemIds.permanent[0]!,
      }),
  },
  ...(["active", "unused", "used", "expired"] as const).map((state) => ({
    name: `shop.inventory ${state}`,
    kind: "read" as const,
    run: (env: BenchEnv) =>
      env.call("shop.inventory", env.actors.user(env.meta.economy.inventoryHeavyUserIds[0]!), {
        state,
        limit: 20,
      }),
  })),
  ...(["all", "buyer", "item", "both"] as const).map((filter) => ({
    name: `shop.purchases ${filter}`,
    kind: "read" as const,
    run: (env: BenchEnv) =>
      env.call("shop.purchases", env.actors.admin, {
        limit: 20,
        ...(filter === "buyer" || filter === "both"
          ? { buyerId: env.meta.economy.richUserIds[0]! }
          : {}),
        ...(filter === "item" || filter === "both"
          ? { itemId: env.meta.economy.itemIds.consumable[0]! }
          : {}),
      }),
  })),
  ...([false, true] as const).flatMap((items) =>
    (["create", "update", "delete"] as const).map((operation) => catalogWrite(operation, items)),
  ),
  ...(["consumable", "permanent", "permission", "group", "gift", "renew"] as const).map(buying),
  ...(["cosmetic", "consumable", "permission", "thread"] as const).map(using),
  expiry(),
];
