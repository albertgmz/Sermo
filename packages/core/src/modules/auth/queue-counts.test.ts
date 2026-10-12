import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { resolvedActor } from "../../permissions/test-contexts";
import {
  approvalSql,
  approvalThreadsSql,
  QUEUE_COUNT_CAP,
  QUEUE_WINDOW,
  reportQueueSql,
} from "../moderation";
import { traceStatements } from "../statement-trace.test";

type Count = { count: number; more: boolean };
const QUIET = { count: 0, more: false };

function world() {
  const ctx = createTestContext();
  const trace = traceStatements(ctx);
  const forumA = insertNode(ctx, {}).id;
  const forumB = insertNode(ctx, {}).id;
  invalidate(ctx, "node_tree");
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const author = insertUser(ctx);
  const moderator = insertUser(ctx, { groupId: 3 });
  const scoped = insertUser(ctx);
  const plain = insertUser(ctx);
  const call = (name: string, actor: object, input: object = {}) =>
    // biome-ignore lint/suspicious/noExplicitAny: tests read the output of any operation
    execute(ctx, getOperation(name), actor as never, input) as Promise<any>;
  const counters = (actor: object) =>
    call("auth.counters", actor) as Promise<{
      openReports: Count;
      pendingApprovals: Count;
    }>;
  let posted = 0;
  /** A post of the author in a forum, directly in the table (its thread, then n posts). */
  const thread = (nodeId: number) => {
    const row = ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO threads (node_id, user_id, last_poster_id, title, state, created_at, last_post_at) VALUES (?1, ?2, ?2, 'T', 'visible', 1, 1) RETURNING id",
      )
      .get(nodeId, author.id)!;
    return row.id;
  };
  const post = (threadId: number, state = "visible") =>
    ctx.sqlite
      .prepare<{ id: number }, [number, number, number, string]>(
        "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, ?4, 1) RETURNING id",
      )
      .get(threadId, author.id, posted++, state)!.id;
  const report = (postId: number, nodeId: number, state = "open") =>
    ctx.sqlite
      .prepare(
        "INSERT INTO report_groups (target_type, target_id, state, created_at, updated_at, node_id) VALUES ('post', ?1, ?2, ?3, ?3, ?4)",
      )
      .run(postId, state, posted++, nodeId);
  const memberReport = (userId: number) =>
    ctx.sqlite
      .prepare(
        "INSERT INTO report_groups (target_type, target_id, state, created_at, updated_at) VALUES ('user', ?1, 'open', ?2, ?2)",
      )
      .run(userId, posted++);
  return {
    ctx,
    trace,
    forumA,
    forumB,
    admin,
    author,
    moderator,
    scoped,
    plain,
    call,
    counters,
    thread,
    post,
    report,
    memberReport,
  };
}
type World = ReturnType<typeof world>;

/** A member who moderates reports and approvals in one forum only, through node entries. */
async function scopeTo(w: World, userId: number, nodeId: number) {
  await w.call("permissions.set", w.admin, {
    userId,
    nodeId,
    entries: [
      { permission: "forum.manageReports", value: "allow" },
      { permission: "forum.approve", value: "allow" },
    ],
  });
}

describe("auth.counters: reports and approvals", () => {
  test("a guest and a member who handles no queue get zeros", async () => {
    const w = world();
    const threadA = w.thread(w.forumA);
    w.report(w.post(threadA), w.forumA);
    w.post(threadA, "moderated");
    expect(await w.counters(GUEST)).toMatchObject({ openReports: QUIET, pendingApprovals: QUIET });
    expect(await w.counters(userActor(w.plain))).toMatchObject({
      openReports: QUIET,
      pendingApprovals: QUIET,
    });
  });

  test("a plain member and a guest run exactly the statements they ran before the totals existed", async () => {
    const w = world();
    const threadA = w.thread(w.forumA);
    w.report(w.post(threadA), w.forumA);
    w.post(threadA, "moderated");
    const member = resolvedActor(w.ctx, w.plain.id);
    await w.counters(member);
    const run = async (actor: object) => {
      w.trace.sql.length = 0;
      await w.counters(actor);
      return w.trace.sql.slice();
    };
    // Before: none for a guest, the one counters statement for a member.
    expect(await run(GUEST)).toEqual([]);
    const statements = await run(member);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("unread_notification_count");
  });

  test("a moderator with other permissions but no queue adds no statement", async () => {
    const w = world();
    // forum.deleteAny is a moderation permission that opens neither queue.
    await w.call("permissions.set", w.admin, {
      userId: w.scoped.id,
      nodeId: w.forumA,
      entries: [{ permission: "forum.deleteAny", value: "allow" }],
    });
    const actor = resolvedActor(w.ctx, w.scoped.id);
    await w.counters(actor);
    w.trace.sql.length = 0;
    expect(await w.counters(actor)).toMatchObject({ openReports: QUIET, pendingApprovals: QUIET });
    expect(w.trace.sql).toHaveLength(1);
  });

  test("a site-wide moderator counts open reports and waiting content, not what is handled", async () => {
    const w = world();
    const threadA = w.thread(w.forumA);
    const threadB = w.thread(w.forumB);
    w.report(w.post(threadA), w.forumA);
    w.report(w.post(threadB), w.forumB);
    w.report(w.post(threadA), w.forumA, "resolved");
    w.report(w.post(threadA), w.forumA, "assigned");
    w.memberReport(w.plain.id);
    w.post(threadA, "moderated");
    w.post(threadB, "moderated");
    w.post(threadB, "moderated");
    w.post(threadB, "deleted");
    const actor = resolvedActor(w.ctx, w.moderator.id);
    expect(await w.counters(actor)).toMatchObject({
      openReports: { count: 3, more: false },
      pendingApprovals: { count: 3, more: false },
    });
    // Settling one changes the number.
    w.ctx.sqlite
      .prepare("UPDATE report_groups SET state = 'resolved' WHERE target_type = 'user'")
      .run();
    expect((await w.counters(actor)).openReports.count).toBe(2);
  });

  test("a moderator of one forum counts only what that forum holds, as the queues list it", async () => {
    const w = world();
    const threadA = w.thread(w.forumA);
    const threadB = w.thread(w.forumB);
    w.report(w.post(threadA), w.forumA);
    w.report(w.post(threadA), w.forumA);
    w.report(w.post(threadB), w.forumB);
    w.memberReport(w.plain.id);
    w.post(threadA, "moderated");
    w.post(threadB, "moderated");
    w.post(threadB, "moderated");
    await scopeTo(w, w.scoped.id, w.forumA);
    const actor = resolvedActor(w.ctx, w.scoped.id);
    const counted = await w.counters(actor);
    expect(counted).toMatchObject({
      openReports: { count: 2, more: false },
      pendingApprovals: { count: 1, more: false },
    });
    // The queue reads agree with the totals.
    const reports = await w.call("reports.list", actor, {});
    const approvals = await w.call("approvals.list", actor, {});
    expect(reports.items).toHaveLength(counted.openReports.count);
    expect(approvals.items).toHaveLength(counted.pendingApprovals.count);
    // Another forum's moderator sees the other numbers.
    await scopeTo(w, w.plain.id, w.forumB);
    expect(await w.counters(resolvedActor(w.ctx, w.plain.id))).toMatchObject({
      openReports: { count: 1, more: false },
      pendingApprovals: { count: 2, more: false },
    });
  });

  test("a banned moderator counts nothing", async () => {
    const w = world();
    w.report(w.post(w.thread(w.forumA)), w.forumA);
    w.ctx.sqlite
      .prepare("UPDATE users SET banned_permanently = 1 WHERE id = ?1")
      .run(w.moderator.id);
    expect(await w.counters(resolvedActor(w.ctx, w.moderator.id))).toMatchObject({
      openReports: QUIET,
      pendingApprovals: QUIET,
    });
  });

  test("the numbers stop at 99 and say when more may wait", async () => {
    const w = world();
    const actor = resolvedActor(w.ctx, w.moderator.id);
    const threadA = w.thread(w.forumA);
    for (let i = 0; i < QUEUE_COUNT_CAP; i++) {
      w.report(w.post(threadA), w.forumA);
      w.post(threadA, "moderated");
    }
    expect(await w.counters(actor)).toMatchObject({
      openReports: { count: 99, more: false },
      pendingApprovals: { count: 99, more: false },
    });
    w.report(w.post(threadA), w.forumA);
    w.post(threadA, "moderated");
    expect(await w.counters(actor)).toMatchObject({
      openReports: { count: 99, more: true },
      pendingApprovals: { count: 99, more: true },
    });
    for (let i = 0; i < 30; i++) {
      w.report(w.post(threadA), w.forumA);
      w.post(threadA, "moderated");
    }
    expect(await w.counters(actor)).toMatchObject({
      openReports: { count: 99, more: true },
      pendingApprovals: { count: 99, more: true },
    });
  });

  test("a moderator pays one bounded read per queue and kind, never a count", async () => {
    const w = world();
    w.report(w.post(w.thread(w.forumA)), w.forumA);
    const actor = resolvedActor(w.ctx, w.moderator.id);
    await w.counters(actor);
    w.trace.sql.length = 0;
    await w.counters(actor);
    // The member's counters, the report queue, and the five approval kinds at most.
    expect(w.trace.sql.length).toBeLessThanOrEqual(7);
    for (const sql of w.trace.sql.slice(1)) {
      expect(sql).not.toMatch(/count\(/i);
      expect(sql).toMatch(/LIMIT \?\d/);
    }
    const everything = Number.MAX_SAFE_INTEGER;
    expectNoTableScan(w.ctx, reportQueueSql(false), ["open", everything, everything, QUEUE_WINDOW]);
    expectNoTableScan(w.ctx, approvalSql, [everything, QUEUE_WINDOW]);
    expectNoTableScan(w.ctx, approvalThreadsSql, [everything, QUEUE_WINDOW]);
  });
});
