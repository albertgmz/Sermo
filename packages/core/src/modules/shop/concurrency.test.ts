import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { closeContext, createContext } from "../../context";
import { writeTx } from "../../db/tx";
import { execute } from "../../operation";
import { moveCredits } from "../../shared/credits";
import { insertCatalogImage } from "../appearance/catalog-fixtures";
import { categoriesCreate, itemsCreate } from "./catalog";

for (const scarce of ["stock", "balance", "unique"] as const)
  test(`independent connections cannot overspend ${scarce}`, async () => {
    const fixture = createTestContext();
    const directory = mkdtempSync(join(tmpdir(), "sermo-shop-"));
    const path = join(directory, "shop.db");
    const workers: Worker[] = [];
    try {
      const admin = userActor(insertUser(fixture, { groupId: 4 }));
      const first = insertUser(fixture);
      const second = insertUser(fixture);
      writeTx(fixture, () =>
        moveCredits(
          fixture,
          [first, second].map((user) => ({
            userId: user.id,
            amount: scarce === "unique" ? 20 : 10,
            type: "adjustment",
          })),
        ),
      );
      const category = await execute(fixture, categoriesCreate, admin, { name: "Concurrent" });
      const item = await execute(fixture, itemsCreate, admin, {
        categoryId: category.id,
        name: "Unit",
        price: 10,
        stock: scarce === "stock" ? 1 : null,
        isConsumable: scarce !== "unique",
        effect: { type: "frame", frameId: insertCatalogImage(fixture, "frame") },
      });
      writeFileSync(path, fixture.sqlite.serialize());
      // Initialize WAL before opening the competing connections.
      closeContext(createContext({ path }));
      const gate = new SharedArrayBuffer(4);
      const ready: Promise<void>[] = [];
      const results: Promise<string>[] = [];
      const exited: Promise<number>[] = [];
      for (const userId of [first.id, scarce === "stock" ? second.id : first.id]) {
        const worker = new Worker(new URL("./purchase-worker.ts", import.meta.url), {
          workerData: { path, userId, itemId: item.id, gate },
        });
        workers.push(worker);
        exited.push(new Promise((resolve) => worker.on("exit", resolve)));
        ready.push(
          new Promise((resolve, reject) => {
            worker.on("error", reject);
            worker.on("message", (value) => {
              if (value === "ready") resolve();
            });
          }),
        );
        results.push(
          new Promise((resolve, reject) => {
            worker.on("error", reject);
            worker.on("message", (value) => {
              if (value !== "ready") resolve(value as string);
            });
          }),
        );
        await ready.at(-1);
      }
      await Promise.all(ready);
      Atomics.store(new Int32Array(gate), 0, 1);
      Atomics.notify(new Int32Array(gate), 0);
      expect((await Promise.all(results)).sort()).toEqual(["bought", "conflict"]);
      await Promise.all(exited);
      const db = createContext({ path });
      try {
        expect(db.sqlite.prepare("SELECT quantity FROM shop_inventory").all()).toEqual([
          { quantity: 1 },
        ]);
        expect(db.sqlite.prepare("SELECT id FROM shop_purchases").all()).toHaveLength(1);
        expect(
          db.sqlite.prepare("SELECT amount FROM credit_transactions WHERE type = 'purchase'").all(),
        ).toEqual([{ amount: -10 }]);
        expect(db.sqlite.prepare("SELECT id FROM users WHERE credits < 0").all()).toEqual([]);
        expect(
          db.sqlite.prepare("SELECT stock FROM shop_items WHERE id = ?1").get(item.id),
        ).toEqual({ stock: scarce === "stock" ? 0 : null });
      } finally {
        closeContext(db);
      }
    } finally {
      await Promise.all(workers.map((worker) => worker.terminate()));
      closeContext(fixture);
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
    }
  }, 15_000);
