import { describe, expect, test } from "bun:test";
import { createTestContext, insertUser, userActor } from "@sermo/core/testing";
import { execute } from "../../operation";
import {
  notificationsListOp,
  notificationsMarkReadOp,
  pageCountSql,
  pageKeySql,
  unreadPageCountSql,
  unreadPageKeySql,
} from "./index";

function alerts() {
  const ctx = createTestContext();
  const a = insertUser(ctx);
  const b = insertUser(ctx);
  const add = (userId: number, at: number) =>
    Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO notifications (user_id, type, content_type, content_id, created_at, updated_at) VALUES (?1, 'member.followed', 'user', ?1, ?2, ?2)",
        )
        .run(userId, at).lastInsertRowid,
    );
  // Five alerts of a, the oldest first; one of b's, which a never sees or counts.
  const mine = [1, 2, 3, 4, 5].map((n) => add(a.id, n * 1000));
  add(b.id, 9000);
  ctx.sqlite.prepare("UPDATE users SET unread_notification_count = 5 WHERE id = ?1").run(a.id);
  return { ctx, a: userActor(a), mine };
}

const ids = (page: { items: { id: number }[] }) => page.items.map((item) => item.id);

describe("notifications.list numbered pages", () => {
  test("pages run from the most recently updated; only the member's own alerts count", async () => {
    const { ctx, a, mine } = alerts();
    const list = (page: number) => execute(ctx, notificationsListOp, a, { page, limit: 2 });
    const [one, two, three, four] = await Promise.all([list(1), list(2), list(3), list(4)]);
    expect(ids(one)).toEqual([mine[4]!, mine[3]!]);
    expect(ids(two)).toEqual([mine[2]!, mine[1]!]);
    expect(ids(three)).toEqual([mine[0]!]);
    expect(ids(four)).toEqual([]);
    for (const page of [one, two, three, four]) expect(page.total).toBe(5);
    expect(three.nextCursor).toBeNull();
    // The cursor goes on from the page's last alert, and a walk by cursor carries no count.
    expect(
      ids(await execute(ctx, notificationsListOp, a, { cursor: one.nextCursor!, limit: 2 })),
    ).toEqual(ids(two));
    expect((await execute(ctx, notificationsListOp, a, { limit: 2 })).total).toBeNull();
  });

  test("unread only counts and pages the unread alerts of the current epoch", async () => {
    const { ctx, a, mine } = alerts();
    await execute(ctx, notificationsMarkReadOp, a, { ids: [mine[4]!, mine[1]!] });
    const list = (page: number) =>
      execute(ctx, notificationsListOp, a, { unreadOnly: true, page, limit: 2 });
    const [one, two] = await Promise.all([list(1), list(2)]);
    expect(ids(one)).toEqual([mine[3]!, mine[2]!]);
    expect(ids(two)).toEqual([mine[0]!]);
    expect(one.total).toBe(3);
    expect(two.total).toBe(3);
    // The whole list still counts every alert.
    expect((await execute(ctx, notificationsListOp, a, { page: 1, limit: 2 })).total).toBe(5);
  });

  test("the position and the count are read from an index, never sorted", () => {
    const { ctx } = alerts();
    const plan = (sql: string, params: number[]) =>
      ctx.sqlite
        .prepare<{ detail: string }, never[]>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...(params as unknown as never[]))
        .map((row) => row.detail)
        .join("\n");
    for (const [sql, params] of [
      [pageKeySql, [1, 40]],
      [pageCountSql, [1]],
    ] as const) {
      expect(plan(sql, [...params])).toContain("USING COVERING INDEX notifications_user_recent");
    }
    // Unread only walks the partial index of the member's unread alerts of the epoch: its
    // `read_at IS NULL` is the index's own condition, so the plan is a range of that index.
    for (const [sql, params] of [
      [unreadPageKeySql, [1, 0, 40]],
      [unreadPageCountSql, [1, 0]],
    ] as const) {
      const text = plan(sql, [...params]);
      expect(text).toContain("notifications_user_unread_recent (user_id=? AND epoch=?)");
      expect(text).not.toContain("TEMP B-TREE");
    }
  });
});
