import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { countersSql } from "./index";

/** What a viewer who handles no queue gets for the two queue counters. */
const QUIET = {
  openReports: { count: 0, more: false, cap: 99 },
  pendingApprovals: { count: 0, more: false, cap: 99 },
};
type TestContext = ReturnType<typeof createTestContext>;
const counters = (ctx: TestContext, actor: Parameters<typeof execute>[2]) =>
  execute(ctx, getOperation("auth.counters"), actor, {}) as Promise<{
    notifications: number;
    conversations: number;
    openReports: { count: number; more: boolean; cap: number };
    pendingApprovals: { count: number; more: boolean; cap: number };
  }>;

function conversation(
  ctx: TestContext,
  memberId: number,
  at: number,
  lastMessageId: number | null,
  lastRead: number,
  state = "active",
) {
  const row = ctx.sqlite
    .prepare<{ id: number }, [number, number, number | null]>(
      "INSERT INTO conversations (title, user_id, created_at, last_message_at, last_message_id, last_message_user_id) VALUES ('c', ?1, ?2, ?2, ?3, ?1) RETURNING id",
    )
    .get(memberId, at, lastMessageId)!;
  ctx.sqlite
    .prepare(
      "INSERT INTO conversation_participants (conversation_id, user_id, state, joined_at, last_message_at, last_read_message_id) VALUES (?1, ?2, ?3, ?4, ?4, ?5)",
    )
    .run(row.id, memberId, state, at, lastRead);
}

describe("auth.counters", () => {
  test("guests get zeros", async () => {
    const ctx = createTestContext();
    expect(await counters(ctx, GUEST)).toEqual({ notifications: 0, conversations: 0, ...QUIET });
  });

  test("an API-key actor gets its member's counters", async () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    ctx.sqlite.prepare("UPDATE users SET unread_notification_count = 3 WHERE id = ?1").run(user.id);
    conversation(ctx, user.id, 1000, 10, 0);
    expect(await counters(ctx, tokenActor(user))).toEqual({
      notifications: 3,
      conversations: 1,
      ...QUIET,
    });
  });

  test("a member with nothing unread gets zeros", async () => {
    const ctx = createTestContext();
    const member = userActor(insertUser(ctx));
    expect(await counters(ctx, member)).toEqual({ notifications: 0, conversations: 0, ...QUIET });
  });

  test("notifications come from the member's counter, conversations from unread inbox entries", async () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    const other = insertUser(ctx);
    ctx.sqlite.prepare("UPDATE users SET unread_notification_count = 4 WHERE id = ?1").run(user.id);
    conversation(ctx, user.id, 1000, 10, 5); // unread
    conversation(ctx, user.id, 2000, 20, 20); // read
    conversation(ctx, user.id, 3000, 30, 0); // unread
    conversation(ctx, user.id, 4000, 40, 1, "left"); // not in the inbox
    conversation(ctx, other.id, 5000, 50, 0); // someone else's
    conversation(ctx, user.id, 500, null, 0); // no message yet: not unread
    expect(await counters(ctx, userActor(user))).toEqual({
      notifications: 4,
      conversations: 2,
      ...QUIET,
    });
    expect(await counters(ctx, userActor(other))).toEqual({
      notifications: 0,
      conversations: 1,
      ...QUIET,
    });
  });

  test("only the 100 most recently active conversations count", async () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    // Five older unread conversations fall outside the 100 newest, which are all read.
    for (let i = 0; i < 5; i++) conversation(ctx, user.id, 100 + i, 10 + i, 0);
    for (let i = 0; i < 100; i++) conversation(ctx, user.id, 1000 + i, 100 + i, 100 + i);
    expect((await counters(ctx, userActor(user))).conversations).toBe(0);
    conversation(ctx, user.id, 5000, 999, 0);
    expect((await counters(ctx, userActor(user))).conversations).toBe(1);
  });

  test("one statement over the inbox index", () => {
    const ctx = createTestContext();
    // "recent" is the 100-row subquery of the newest inbox entries.
    expectNoTableScan(ctx, countersSql, [1], { allow: ["recent"] });
    const plan = ctx.sqlite
      .prepare<{ detail: string }, [number]>(`EXPLAIN QUERY PLAN ${countersSql}`)
      .all(1)
      .map((row) => row.detail)
      .join("\n");
    expect(plan).toContain("conversation_participants_inbox");
  });
});
