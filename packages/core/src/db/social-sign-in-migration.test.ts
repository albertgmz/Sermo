import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import journal from "../../drizzle/meta/_journal.json";
import { type Ctx, closeContext, createContext } from "../context";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

const index = journal.entries.find((entry) => entry.tag.endsWith("social_sign_in"))!.idx;

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

test("the social sign-in migration marks no existing member and does not rebuild the table", () => {
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
  const rootpage = () =>
    ctx.sqlite
      .prepare<{ rootpage: number }, []>("SELECT rootpage FROM sqlite_master WHERE name = 'users'")
      .get()!.rootpage;
  const root = rootpage();
  applyMigrations(ctx, index, index);
  expect(rootpage()).toBe(root);
  expect(
    ctx.sqlite
      .prepare<{ needs_username: number }, []>("SELECT needs_username FROM users WHERE id = 7")
      .get()!.needs_username,
  ).toBe(0);
});
