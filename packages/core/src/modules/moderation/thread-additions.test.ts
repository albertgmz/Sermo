import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { actorUserId } from "../../actor";
import { invalidate } from "../../context";
import { writeTx } from "../../db/tx";
import { ForbiddenError } from "../../errors";
import { execute } from "../../operation";
import {
  nodesSetModeratorOp,
  nodesUpdateOp,
  postsCreateOp,
  postsUpdateOp,
  threadsCreateOp,
} from "../forums";
import { runDueJobs } from "../jobs";
import {
  appendModeratorLog,
  approvalSql,
  bulkModerate,
  cleanupSpam,
  createReport,
  listApprovals,
  listModeratorLog,
  listReports,
  registerModerationJobs,
} from ".";

describe("node moderation queues", () => {
  test("approval cursors retain every item across a boundary", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const author = userActor(insertUser(ctx));
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "A",
      body: "A",
    });
    await execute(ctx, nodesUpdateOp, admin, {
      nodeId: node.id,
      settings: { requireReplyApproval: true },
    });
    const expected: number[] = [];
    for (let i = 0; i < 4; i++)
      expected.push(
        (
          await execute(ctx, postsCreateOp, author, {
            threadId: thread.thread.id,
            body: `Held ${i}`,
          })
        ).id,
      );
    const seen: number[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 8; page++) {
      const result = listApprovals(ctx, admin, { limit: 1, cursor });
      seen.push(...result.items.filter((row) => row.type === "post").map((row) => row.id));
      cursor = result.nextCursor;
      if (!cursor) break;
    }
    expect(seen.sort((a, b) => a - b)).toEqual(expected.sort((a, b) => a - b));
    expect(cursor).toBeNull();
  });

  test("approval candidates use state and id indexes before checking nodes", () => {
    const ctx = createTestContext();
    expectNoTableScan(ctx, approvalSql, [999, 50]);
    expectNoTableScan(
      ctx,
      "SELECT id, user_id, node_id, created_at, state FROM threads INDEXED BY threads_state_id WHERE state = 'moderated' AND id <= ?1 ORDER BY id DESC LIMIT ?2",
      [999, 50],
    );
    expectNoTableScan(
      ctx,
      "SELECT id, user_id, conversation_id, created_at, state FROM conversation_messages INDEXED BY conversation_messages_state_id WHERE state = 'moderated' AND id <= ?1 ORDER BY id DESC LIMIT ?2",
      [999, 50],
    );
  });

  test("node approval pages stay resumable after a capped run of other nodes", async () => {
    const ctx = createTestContext();
    const a = insertNode(ctx, {});
    const b = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const author = userActor(insertUser(ctx));
    const local = userActor(insertUser(ctx));
    await execute(ctx, nodesSetModeratorOp, admin, { nodeId: a.id, userId: actorUserId(local)! });
    for (const node of [a, b])
      await execute(ctx, nodesUpdateOp, admin, {
        nodeId: node.id,
        settings: { requireThreadApproval: true },
      });
    const wanted = await execute(ctx, threadsCreateOp, author, {
      nodeId: a.id,
      title: "Wanted",
      body: "Body",
    });
    for (let i = 0; i < 12; i++)
      await execute(ctx, threadsCreateOp, author, {
        nodeId: b.id,
        title: `Other ${i}`,
        body: "Body",
      });
    const first = listApprovals(ctx, local, { nodeId: a.id, limit: 2 });
    expect(first.items).toHaveLength(0);
    expect(first.nextCursor).toBeString();
    const found: number[] = [];
    let cursor = first.nextCursor;
    for (let i = 0; i < 8 && cursor; i++) {
      const next = listApprovals(ctx, local, { nodeId: a.id, limit: 2, cursor });
      found.push(...next.items.filter((row) => row.type === "thread").map((row) => row.id));
      cursor = next.nextCursor;
    }
    expect(found).toContain(wanted.thread.id);
    expect(cursor).toBeNull();
  });

  test("report and log scans return short pages with resumable cursors", async () => {
    const ctx = createTestContext();
    const a = insertNode(ctx, {});
    const b = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const author = userActor(insertUser(ctx));
    const local = userActor(insertUser(ctx));
    await execute(ctx, nodesSetModeratorOp, admin, { nodeId: a.id, userId: actorUserId(local)! });
    const allowed = await execute(ctx, threadsCreateOp, author, {
      nodeId: a.id,
      title: "Allowed",
      body: "A",
    });
    createReport(ctx, author, { type: "post", id: allowed.post.id }, "A report");
    writeTx(ctx, () =>
      appendModeratorLog(ctx, admin, "test.allowed", "thread", allowed.thread.id, "", {}, a.id),
    );
    for (let i = 0; i < 12; i++) {
      const hidden = await execute(ctx, threadsCreateOp, author, {
        nodeId: b.id,
        title: `Hidden ${i}`,
        body: "B",
      });
      createReport(ctx, author, { type: "post", id: hidden.post.id }, "B report");
      writeTx(ctx, () =>
        appendModeratorLog(ctx, admin, "test.hidden", "thread", hidden.thread.id, "", {}, b.id),
      );
    }
    const firstReports = listReports(ctx, local, { limit: 2 });
    expect(firstReports.items).toHaveLength(0);
    expect(firstReports.nextCursor).toBeString();
    let cursor = firstReports.nextCursor;
    const found: number[] = [];
    for (let page = 0; page < 8 && cursor; page++) {
      const result = listReports(ctx, local, { limit: 2, cursor });
      found.push(...result.items.map((row) => row.id));
      cursor = result.nextCursor;
    }
    expect(found).toHaveLength(1);
    const firstLog = listModeratorLog(ctx, local, { limit: 2 });
    expect(firstLog.items).toHaveLength(0);
    expect(firstLog.nextCursor).toBeString();
  });
  test("reports, approvals and log use node scope and explicit node filters", async () => {
    const ctx = createTestContext();
    const a = insertNode(ctx, {});
    const b = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const author = userActor(insertUser(ctx));
    const local = userActor(insertUser(ctx));
    await execute(ctx, nodesSetModeratorOp, admin, {
      nodeId: a.id,
      userId: local.kind === "guest" ? 0 : local.userId,
    });
    const first = await execute(ctx, threadsCreateOp, author, {
      nodeId: a.id,
      title: "A",
      body: "A",
    });
    const second = await execute(ctx, threadsCreateOp, author, {
      nodeId: b.id,
      title: "B",
      body: "B",
    });
    createReport(ctx, author, { type: "post", id: first.post.id }, "A report");
    createReport(ctx, author, { type: "post", id: second.post.id }, "B report");
    expect(listReports(ctx, local).items).toHaveLength(1);
    expect(listReports(ctx, local, { limit: 1 }).items).toHaveLength(1);
    expect(listReports(ctx, local, { nodeId: a.id }).items).toHaveLength(1);
    expect(() => listReports(ctx, local, { nodeId: b.id })).toThrow(ForbiddenError);
    await execute(ctx, nodesUpdateOp, admin, {
      nodeId: a.id,
      settings: { requireThreadApproval: true },
    });
    await execute(ctx, nodesUpdateOp, admin, {
      nodeId: b.id,
      settings: { requireThreadApproval: true },
    });
    const heldA = await execute(ctx, threadsCreateOp, author, {
      nodeId: a.id,
      title: "Held A",
      body: "A",
    });
    const heldB = await execute(ctx, threadsCreateOp, author, {
      nodeId: b.id,
      title: "Held B",
      body: "B",
    });
    expect(listApprovals(ctx, local, { nodeId: a.id }).items.map((row) => row.id)).toContain(
      heldA.thread.id,
    );
    expect(listApprovals(ctx, local).items.map((row) => row.id)).not.toContain(heldB.thread.id);
    expect(listApprovals(ctx, local, { limit: 1 }).items.map((row) => row.id)).toContain(
      heldA.thread.id,
    );
    expect(() => listApprovals(ctx, local, { nodeId: b.id })).toThrow(ForbiddenError);
    writeTx(ctx, () => {
      appendModeratorLog(ctx, admin, "test.a", "thread", first.thread.id, "", {}, a.id);
      appendModeratorLog(ctx, admin, "test.b", "thread", second.thread.id, "", {}, b.id);
    });
    expect(
      listModeratorLog(ctx, local, { nodeId: a.id }).items.every((row) => row.node_id === a.id),
    ).toBe(true);
    expect(listModeratorLog(ctx, local).items.every((row) => row.node_id === a.id)).toBe(true);
    expect(listModeratorLog(ctx, local, { limit: 1 }).items).toHaveLength(1);
    expect(() => listModeratorLog(ctx, local, { nodeId: b.id })).toThrow(ForbiddenError);
  });
});

describe("moderation around thread transfers and log nodes", () => {
  test("spam cleanup waits once for a pending transfer and logs a failed one once", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    registerModerationJobs(ctx);
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const spammer = userActor(insertUser(ctx));
    const spammerId = actorUserId(spammer)!;
    const thread = await execute(ctx, threadsCreateOp, spammer, {
      nodeId: node.id,
      title: "Spam",
      body: "Spam",
    });
    ctx.sqlite
      .prepare(
        "INSERT INTO thread_transfers (thread_id, role, other_thread_id, job_key, created_at) VALUES (?1, 'split_source', ?1, 'forums.split.0', ?2)",
      )
      .run(thread.thread.id, ctx.now());
    cleanupSpam(ctx, admin, spammerId, 0);
    cleanupSpam(ctx, admin, spammerId, 0);
    const jobs = ctx.sqlite.prepare<{ status: string; n: number }, []>(
      "SELECT status, count(*) AS n FROM jobs WHERE type = 'moderation.cleanupSpam' GROUP BY status ORDER BY status",
    );
    expect(jobs.all()).toEqual([{ status: "pending", n: 1 }]);
    const logRows = ctx.sqlite.prepare<{ n: number }, []>(
      "SELECT count(*) AS n FROM moderator_log",
    );
    const logged = logRows.get()!.n;
    // While the transfer is pending, the waiting run waits again.
    ctx.sqlite.prepare("UPDATE jobs SET run_at = 0 WHERE status = 'pending'").run();
    await runDueJobs(ctx);
    expect(jobs.all()).toEqual([
      { status: "done", n: 1 },
      { status: "pending", n: 1 },
    ]);
    // A waiting run only checks the guard: no scan, no log rows.
    expect(logRows.get()!.n).toBe(logged);
    // A failed transfer needs a moderator: the next run logs the skip and stops waiting.
    ctx.sqlite.prepare("UPDATE thread_transfers SET failed_at = ?1").run(ctx.now());
    ctx.sqlite.prepare("UPDATE jobs SET run_at = 0 WHERE status = 'pending'").run();
    await runDueJobs(ctx);
    await runDueJobs(ctx);
    expect(jobs.all()).toEqual([{ status: "done", n: 2 }]);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM moderator_log WHERE action = 'spam.cleanup.skipped' AND target_id = ?1",
        )
        .get(spammerId)!.n,
    ).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ state: string }, [number]>("SELECT state FROM threads WHERE id = ?1")
        .get(thread.thread.id)!.state,
    ).toBe("visible");
  });

  test("unchanged bulk entries and moderator edits record the thread's node", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const author = userActor(insertUser(ctx));
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Thread",
      body: "Body",
    });
    const reply = await execute(ctx, postsCreateOp, author, {
      threadId: thread.thread.id,
      body: "Reply",
    });
    const target = { type: "thread" as const, id: thread.thread.id };
    expect(bulkModerate(ctx, moderator, [target], "unlock").changed).toBe(0);
    expect(bulkModerate(ctx, moderator, [target], "move", "", node.id).changed).toBe(0);
    expect(bulkModerate(ctx, moderator, [{ type: "post", id: reply.id }], "restore").changed).toBe(
      0,
    );
    await execute(ctx, postsUpdateOp, moderator, { postId: reply.id, body: "Edited" });
    expect(
      ctx.sqlite
        .prepare<{ action: string; node_id: number | null }, []>(
          "SELECT action, node_id FROM moderator_log WHERE action IN ('bulk.unlock', 'bulk.move', 'bulk.restore', 'post.edit') ORDER BY id",
        )
        .all(),
    ).toEqual([
      { action: "bulk.unlock", node_id: node.id },
      { action: "bulk.move", node_id: node.id },
      { action: "bulk.restore", node_id: node.id },
      { action: "post.edit", node_id: node.id },
    ]);
  });

  test("spam cleanup stops waiting for a transfer after a day, with one log entry", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    registerModerationJobs(ctx);
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const spammer = userActor(insertUser(ctx));
    const spammerId = actorUserId(spammer)!;
    const other = await execute(ctx, threadsCreateOp, admin, {
      nodeId: node.id,
      title: "Busy",
      body: "Body",
    });
    // The spammer's reply sits in a thread with a pending transfer.
    await execute(ctx, postsCreateOp, spammer, { threadId: other.thread.id, body: "Spam" });
    ctx.sqlite
      .prepare(
        "INSERT INTO thread_transfers (thread_id, role, other_thread_id, job_key, created_at) VALUES (?1, 'merge_target', ?1, 'forums.merge.0', ?2)",
      )
      .run(other.thread.id, ctx.now());
    const started = ctx.now();
    cleanupSpam(ctx, admin, spammerId, 0);
    const waiting = ctx.sqlite.prepare<{ n: number }, []>(
      "SELECT count(*) AS n FROM jobs WHERE type = 'moderation.cleanupSpam' AND status = 'pending'",
    );
    for (let minute = 1; waiting.get()!.n && minute <= 24 * 60 + 5; minute++) {
      ctx.clock.set(started + minute * 60_000);
      await runDueJobs(ctx);
    }
    expect(waiting.get()!.n).toBe(0);
    expect(ctx.now()).toBeGreaterThanOrEqual(started + 86_400_000);
    expect(
      ctx.sqlite
        .prepare<{ details: string }, [number]>(
          "SELECT details FROM moderator_log WHERE action = 'spam.cleanup.skipped' AND target_id = ?1",
        )
        .all(spammerId)
        .map((row) => JSON.parse(row.details)),
    ).toEqual([{ transfer: "still pending" }]);
  });
});
