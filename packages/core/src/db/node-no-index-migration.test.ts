import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { insertNode } from "@sermo/core/testing";
import journal from "../../drizzle/meta/_journal.json";
import { type Ctx, closeContext, createContext } from "../context";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

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

test("migration 0088 leaves every existing forum open to indexing and keeps its other columns", () => {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, 87);
  const category = insertNode(ctx, { type: "category", title: "Old category" });
  const forum = insertNode(ctx, { parentId: category.id, title: "Old forum" });
  ctx.sqlite.run("UPDATE nodes SET is_adult = 1 WHERE id = ?1", [forum.id]);
  applyMigrations(ctx, 88, 88);
  expect(
    ctx.sqlite.query("SELECT id, title, is_adult, no_index FROM nodes ORDER BY id").all(),
  ).toEqual([
    { id: category.id, title: "Old category", is_adult: 0, no_index: 0 },
    { id: forum.id, title: "Old forum", is_adult: 1, no_index: 0 },
  ]);
});
