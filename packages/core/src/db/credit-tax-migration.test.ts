import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import journal from "../../drizzle/meta/_journal.json";
import { type Ctx, closeContext, createContext } from "../context";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

const index = journal.entries.find((entry) => entry.tag.endsWith("credit_tax"))!.idx;

function applyMigrations(ctx: Ctx, from: number, through: number) {
  ctx.sqlite.transaction(() => {
    for (const entry of journal.entries.filter(
      (entry) => entry.idx >= from && entry.idx <= through,
    )) {
      const sql = readFileSync(new URL(`../../drizzle/${entry.tag}.sql`, import.meta.url), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) ctx.sqlite.run(statement);
    }
  })();
}

test("the credit tax migration keeps the ledger as it is and makes a second tax row impossible", () => {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, index - 1);
  ctx.sqlite.run(
    "INSERT INTO auth_user (id, name, email, email_verified, username, display_username, created_at, updated_at) " +
      "VALUES (7, 'Ana', 'ana@example.test', 0, 'ana', 'Ana', 1, 1)",
  );
  ctx.sqlite.run(
    "INSERT INTO users (id, username, username_key, group_id, created_at) VALUES (7, 'Ana', 'ana', 2, 1)",
  );
  const ledger = (source: string | null, sourceId: number | null) =>
    ctx.sqlite
      .prepare(
        "INSERT INTO credit_transactions (user_id, amount, balance_after, type, source_type, source_id, created_at) VALUES (7, -5, 5, 'adjustment', ?1, ?2, 1)",
      )
      .run(source, sourceId);
  // Rows that share a member and a source id, as other sources do: none is a tax row.
  ledger("shop_purchase", 202611);
  ledger("shop_purchase", 202611);
  ledger(null, null);
  const before = ctx.sqlite.prepare("SELECT * FROM credit_transactions ORDER BY id").all();
  const rootpage = () =>
    ctx.sqlite
      .prepare<{ rootpage: number }, []>(
        "SELECT rootpage FROM sqlite_master WHERE name = 'credit_transactions'",
      )
      .get()!.rootpage;
  const root = rootpage();
  applyMigrations(ctx, index, index);
  expect(ctx.sqlite.prepare("SELECT * FROM credit_transactions ORDER BY id").all()).toEqual(before);
  // The table is not rebuilt.
  expect(rootpage()).toBe(root);
  ledger("tax", 202611);
  expect(() => ledger("tax", 202611)).toThrow(/UNIQUE/);
  ledger("tax", 202612);
  expect(ctx.sqlite.prepare("SELECT id FROM credit_tax_runs").all()).toEqual([]);
});
