import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { insertNode, insertUser } from "@sermo/core/testing";
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

test("migration 0089 leaves every existing thread on the templates and keeps its other columns", () => {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, 88);
  const user = insertUser(ctx);
  const forum = insertNode(ctx, { title: "Old forum" });
  ctx.sqlite.run(
    "INSERT INTO threads (node_id, user_id, title, state, created_at, last_post_at, last_poster_id, excerpt) VALUES (?1, ?2, 'Old thread', 'visible', 1, 1, ?2, 'Old excerpt')",
    [forum.id, user.id],
  );
  applyMigrations(ctx, 89, 89);
  expect(
    ctx.sqlite.query("SELECT title, excerpt, seo_title, seo_description FROM threads").all(),
  ).toEqual([
    { title: "Old thread", excerpt: "Old excerpt", seo_title: null, seo_description: null },
  ]);
});
