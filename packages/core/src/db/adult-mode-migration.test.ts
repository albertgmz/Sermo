import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import journal from "../../drizzle/meta/_journal.json";
import { type Ctx, closeContext, createContext } from "../context";
import { insertNode, insertUser } from "../testing";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

const index = journal.entries.find((entry) => entry.tag.endsWith("adult_mode"))!.idx;

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

test("the +18 migration adds unmarked columns to existing members, forums and threads", () => {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, index - 1);
  const member = insertUser(ctx);
  const forum = insertNode(ctx, {});
  const thread = ctx.sqlite
    .prepare<{ id: number }, [number, number]>(
      "INSERT INTO threads (node_id, user_id, title, created_at, last_post_at, last_poster_id) VALUES (?1, ?2, 'T', 1, 1, ?2) RETURNING id",
    )
    .get(forum.id, member.id)!.id;
  applyMigrations(ctx, index, index);
  expect(
    ctx.sqlite
      .prepare("SELECT profile_adult, adult_accepted_at FROM users WHERE id = ?1")
      .get(member.id),
  ).toEqual({ profile_adult: 0, adult_accepted_at: null });
  expect(ctx.sqlite.prepare("SELECT is_adult FROM nodes WHERE id = ?1").get(forum.id)).toEqual({
    is_adult: 0,
  });
  expect(ctx.sqlite.prepare("SELECT is_adult FROM threads WHERE id = ?1").get(thread)).toEqual({
    is_adult: 0,
  });
  // The partial index holds only marked threads.
  ctx.sqlite.prepare("UPDATE threads SET is_adult = 1 WHERE id = ?1").run(thread);
  expect(
    ctx.sqlite
      .prepare(
        "SELECT count(*) AS n FROM threads INDEXED BY threads_adult WHERE node_id = ?1 AND is_adult = 1 AND is_sticky = 0 AND state = 'visible'",
      )
      .get(forum.id),
  ).toEqual({ n: 1 });
});
