import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

function member(ctx: Ctx, id: number, epoch: number, unread: number) {
  ctx.sqlite
    .prepare(
      "INSERT INTO users (id, username, username_key, group_id, created_at, notification_epoch, unread_notification_count) VALUES (?1, ?2, ?2, 2, 0, ?3, ?4)",
    )
    .run(id, `user${id}`, epoch, unread);
}

function notice(ctx: Ctx, userId: number, type: string, epoch: number, readAt: number | null) {
  ctx.sqlite
    .prepare(
      "INSERT INTO notifications (user_id, epoch, type, content_type, content_id, created_at, updated_at, read_at) VALUES (?1, ?2, ?3, 'conversation_message', 1, 0, 0, ?4)",
    )
    .run(userId, epoch, type, readAt);
}

test("migration 0033 marks unread conversation message alerts read and keeps the counters consistent", () => {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, 32);
  ctx.sqlite.run("PRAGMA foreign_keys = OFF");
  // Member 101: two unread conversation alerts, one other alert, one already read.
  member(ctx, 101, 0, 3);
  notice(ctx, 101, "conversation.message", 0, null);
  notice(ctx, 101, "conversation.message", 0, null);
  notice(ctx, 101, "conversation.message", 0, 5);
  notice(ctx, 101, "content.mentioned", 0, null);
  // Member 102: the epoch moved on ("mark all read"), the old alert already counts as read.
  member(ctx, 102, 1, 1);
  notice(ctx, 102, "conversation.message", 0, null);
  notice(ctx, 102, "conversation.message", 1, null);
  // Member 104's counter has drifted below its unread rows: it stops at zero.
  member(ctx, 104, 0, 0);
  notice(ctx, 104, "conversation.message", 0, null);
  // Member 103 has nothing of that kind.
  member(ctx, 103, 0, 1);
  notice(ctx, 103, "content.mentioned", 0, null);

  applyMigrations(ctx, 33, 33);

  const counts = ctx.sqlite
    .prepare<{ id: number; unread_notification_count: number }, []>(
      "SELECT id, unread_notification_count FROM users ORDER BY id",
    )
    .all();
  expect(counts.map((row) => row.unread_notification_count)).toEqual([1, 0, 1, 0]);
  // Every member's counter equals the unread rows of the current epoch.
  for (const row of counts) {
    const unread = ctx.sqlite
      .prepare<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.id = ?1 AND n.read_at IS NULL AND n.epoch = u.notification_epoch",
      )
      .get(row.id)!.n;
    expect(row.unread_notification_count).toBe(unread);
  }
  // The rows stay, read.
  expect(
    ctx.sqlite
      .prepare<{ n: number }, []>(
        "SELECT count(*) AS n FROM notifications WHERE type = 'conversation.message' AND read_at IS NULL",
      )
      .get()!.n,
  ).toBe(0);
  expect(
    ctx.sqlite
      .prepare<{ n: number }, []>(
        "SELECT count(*) AS n FROM notifications WHERE type = 'conversation.message'",
      )
      .get()!.n,
  ).toBe(6);
  // The row that was read before keeps its time.
  expect(
    ctx.sqlite
      .prepare<{ read_at: number }, []>(
        "SELECT read_at FROM notifications WHERE type = 'conversation.message' AND read_at = 5",
      )
      .all(),
  ).toHaveLength(1);
});
