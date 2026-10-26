import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import journal from "../../drizzle/meta/_journal.json";
import { type Ctx, closeContext, createContext } from "../context";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

const BLOCKS = journal.entries.find((entry) => entry.tag.endsWith("_blocks"))!.idx;

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

test("the blocks migration turns every ignore into a block and hides no conversation", () => {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, BLOCKS - 1);
  ctx.sqlite.run("PRAGMA foreign_keys = OFF");
  for (const id of [101, 102, 103])
    ctx.sqlite
      .prepare(
        "INSERT INTO users (id, username, username_key, group_id, created_at) VALUES (?1, ?2, ?2, 2, 0)",
      )
      .run(id, `user${id}`);
  const ignore = ctx.sqlite.prepare(
    "INSERT INTO user_ignores (id, user_id, ignored_id, created_at) VALUES (?1, ?2, ?3, ?4)",
  );
  ignore.run(7, 101, 102, 1_000);
  ignore.run(9, 103, 101, 2_000);
  // A private conversation of the first pair, from before the deploy.
  ctx.sqlite.run(
    "INSERT INTO conversations (id, title, user_id, created_at, last_message_at, last_message_user_id, participant_count) VALUES (1, 'Old', 101, 0, 0, 101, 2)",
  );
  for (const id of [101, 102])
    ctx.sqlite
      .prepare(
        "INSERT INTO conversation_participants (conversation_id, user_id, joined_at, last_message_at) VALUES (1, ?1, 0, 0)",
      )
      .run(id);
  // An administrator's value for the permission to ignore.
  const definition = ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO permission_definitions (key, scope, value_type, created_at) VALUES ('member.ignore', 'global', 'flag', 0) RETURNING id",
    )
    .get()!.id;
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, 2, 0, -1)",
    )
    .run(definition);

  applyMigrations(ctx, BLOCKS, BLOCKS);

  expect(
    ctx.sqlite
      .prepare("SELECT id, user_id, blocked_id, created_at FROM user_blocks ORDER BY id")
      .all(),
  ).toEqual([
    { id: 7, user_id: 101, blocked_id: 102, created_at: 1_000 },
    { id: 9, user_id: 103, blocked_id: 101, created_at: 2_000 },
  ]);
  expect(
    ctx.sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'user_ignores'").get(),
  ).toBeNull();
  expect(
    ctx.sqlite.prepare("SELECT state FROM conversation_participants ORDER BY user_id").all(),
  ).toEqual([{ state: "active" }, { state: "active" }]);
  expect(
    ctx.sqlite.prepare("SELECT hidden_at, participant_count FROM conversations").get(),
  ).toEqual({ hidden_at: null, participant_count: 2 });
  expect(
    ctx.sqlite
      .prepare(
        "SELECT d.key, e.value FROM permission_entries e JOIN permission_definitions d ON d.id = e.permission_id WHERE d.id = ?1",
      )
      .get(definition),
  ).toEqual({ key: "member.block", value: -1 });
});
