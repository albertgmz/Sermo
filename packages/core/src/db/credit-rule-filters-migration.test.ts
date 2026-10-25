import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import journal from "../../drizzle/meta/_journal.json";
import { type Ctx, closeContext, createContext } from "../context";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

const index = journal.entries.find((entry) => entry.tag.endsWith("credit_rule_filters"))!.idx;

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

test("the credit rule filters migration leaves existing rules without filters", () => {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, index - 1);
  const rule = ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO credit_rules (title, trigger, amount, created_at, updated_at) VALUES ('Replies', 'reply_posted', 5, 1, 1) RETURNING id",
    )
    .get()!.id;
  applyMigrations(ctx, index, index);
  expect(
    ctx.sqlite
      .prepare(
        "SELECT source_from, source_until, source_min_length, source_max_length FROM credit_rules WHERE id = ?1",
      )
      .get(rule),
  ).toEqual({
    source_from: null,
    source_until: null,
    source_min_length: null,
    source_max_length: null,
  });
});
