import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import { ConflictError, ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { can } from "../../permissions";
import { enqueueJob, runDueJobs } from "../jobs";
import { bulkModerate, createReport, moderateContent, registerModerationJobs } from "../moderation";
import {
  mergeThreadChunk,
  nodesSetModeratorOp,
  nodesUpdateOp,
  postsCreateOp,
  postsDeleteOp,
  postsRestoreOp,
  threadsCreateOp,
  threadsDeleteOp,
  threadsGetOp,
  threadsListOp,
  threadsMarkReadOp,
  threadsMergeOp,
  threadsMoveOp,
  threadsRestoreOp,
  threadsSplitOp,
} from "./index";

function setup() {
  const ctx = createTestContext();
  const node = insertNode(ctx, {});
  const otherNode = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const author = userActor(insertUser(ctx));
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  registerModerationJobs(ctx);
  return { ctx, node, otherNode, author, moderator, admin };
}

/** Appends visible posts to a visible thread and keeps its thread, node and author counters. */
function addPosts(
  ctx: Ctx,
  threadId: number,
  userId: number,
  count: number,
  createdAt: (i: number) => number,
): number[] {
  const start =
    ctx.sqlite
      .prepare<{ position: number }, [number]>(
        "SELECT max(position) AS position FROM posts WHERE thread_id = ?1",
      )
      .get(threadId)!.position + 1;
  const insert = ctx.sqlite.prepare(
    "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'visible', ?4)",
  );
  const body = ctx.sqlite.prepare(
    "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'x', '<p>x</p>')",
  );
  const ids: number[] = [];
  for (let i = 1; i <= count; i++) {
    const id = Number(insert.run(threadId, userId, start + i - 1, createdAt(i)).lastInsertRowid);
    body.run(id);
    ids.push(id);
  }
  ctx.sqlite
    .prepare(
      "UPDATE threads SET reply_count = reply_count + ?2, last_post_id = ?3, last_post_at = ?4 WHERE id = ?1",
    )
    .run(threadId, count, ids.at(-1)!, createdAt(count));
  ctx.sqlite
    .prepare(
      "UPDATE nodes SET post_count = post_count + ?2 WHERE id = (SELECT node_id FROM threads WHERE id = ?1)",
    )
    .run(threadId, count);
  ctx.sqlite
    .prepare("UPDATE users SET post_count = post_count + ?2 WHERE id = ?1")
    .run(userId, count);
  return ids;
}

/** Positions 0..count-1 without gaps or duplicates, the first post first, the rest in creation order. */
function expectMergedInOrder(ctx: Ctx, threadId: number, firstPostId: number, count: number) {
  const rows = ctx.sqlite
    .prepare<{ id: number; position: number; created_at: number }, [number]>(
      "SELECT id, position, created_at FROM posts WHERE thread_id = ?1 ORDER BY position",
    )
    .all(threadId);
  expect(rows.map((row) => row.position)).toEqual(Array.from({ length: count }, (_, i) => i));
  expect(rows[0]!.id).toBe(firstPostId);
  const rest = rows.slice(1);
  expect(rest.map((row) => row.id)).toEqual(
    [...rest].sort((a, b) => a.created_at - b.created_at || a.id - b.id).map((row) => row.id),
  );
  expect(
    ctx.sqlite
      .prepare<{ first_post_id: number }, [number]>(
        "SELECT first_post_id FROM threads WHERE id = ?1",
      )
      .get(threadId)!.first_post_id,
  ).toBe(firstPostId);
}

function expectCounters(ctx: Ctx, nodeId: number, threadIds: number[], userIds: number[]) {
  for (const id of threadIds) {
    const visible = ctx.sqlite
      .prepare<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM posts WHERE thread_id = ?1 AND state = 'visible'",
      )
      .get(id)!.n;
    expect(
      ctx.sqlite
        .prepare<{ reply_count: number }, [number]>("SELECT reply_count FROM threads WHERE id = ?1")
        .get(id)!.reply_count,
    ).toBe(Math.max(0, visible - 1));
  }
  expect(
    ctx.sqlite
      .prepare<{ post_count: number }, [number]>("SELECT post_count FROM nodes WHERE id = ?1")
      .get(nodeId)!.post_count,
  ).toBe(
    ctx.sqlite
      .prepare<{ n: number }, [number]>(
        "SELECT count(*) AS n FROM posts p JOIN threads t ON t.id = p.thread_id WHERE t.node_id = ?1 AND t.state = 'visible' AND p.state = 'visible'",
      )
      .get(nodeId)!.n,
  );
  for (const userId of userIds)
    expect(
      ctx.sqlite
        .prepare<{ post_count: number }, [number]>("SELECT post_count FROM users WHERE id = ?1")
        .get(userId)!.post_count,
    ).toBe(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.user_id = ?1 AND p.state = 'visible' AND t.state = 'visible'",
        )
        .get(userId)!.n,
    );
}

describe("thread moderation additions", () => {
  test("merge keeps the target first post at zero when the source is older", async () => {
    const { ctx, node, author, moderator } = setup();
    const target = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Target",
      body: "Target first",
    });
    const targetReply = await execute(ctx, postsCreateOp, author, {
      threadId: target.thread.id,
      body: "Target reply",
    });
    const source = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Source",
      body: "Source first",
    });
    const sourceReply = await execute(ctx, postsCreateOp, author, {
      threadId: source.thread.id,
      body: "Source reply",
    });
    const stamp = ctx.sqlite.prepare("UPDATE posts SET created_at = ?1 WHERE id = ?2");
    stamp.run(100, source.post.id);
    stamp.run(200, sourceReply.id);
    stamp.run(300, target.post.id);
    stamp.run(400, targetReply.id);
    const result = await execute(ctx, threadsMergeOp, moderator, {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
    });
    expect(result.completed).toBe(true);
    const rows = ctx.sqlite
      .prepare<{ id: number; position: number }, [number]>(
        "SELECT id, position FROM posts WHERE thread_id = ?1 ORDER BY position",
      )
      .all(target.thread.id);
    expect(rows.map((row) => row.id)).toEqual([
      target.post.id,
      source.post.id,
      sourceReply.id,
      targetReply.id,
    ]);
    expect(rows.map((row) => row.position)).toEqual([0, 1, 2, 3]);
    expect(
      ctx.sqlite
        .prepare<{ first_post_id: number }, [number]>(
          "SELECT first_post_id FROM threads WHERE id = ?1",
        )
        .get(target.thread.id)?.first_post_id,
    ).toBe(target.post.id);
  });

  test("splitting a read last post reanchors the source before merging it back", async () => {
    const { ctx, node, author, moderator } = setup();
    const reader = userActor(insertUser(ctx));
    const source = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Read source",
      body: "First",
    });
    const posts = [source.post];
    for (let i = 1; i <= 4; i++)
      posts.push(
        await execute(ctx, postsCreateOp, author, {
          threadId: source.thread.id,
          body: `Reply ${i}`,
        }),
      );
    ctx.sqlite
      .prepare(
        "INSERT INTO thread_reads (user_id, thread_id, last_read_post_id, last_read_position, read_at) VALUES (?1, ?2, ?3, 4, ?4)",
      )
      .run(actorUserId(reader)!, source.thread.id, posts[4]!.id, ctx.now());
    const split = await execute(ctx, threadsSplitOp, moderator, {
      threadId: source.thread.id,
      postIds: [posts[4]!.id],
      title: "Last",
      nodeId: node.id,
    });
    const marker = ctx.sqlite.prepare<
      { last_read_post_id: number; last_read_position: number },
      [number, number]
    >(
      "SELECT last_read_post_id, last_read_position FROM thread_reads WHERE user_id = ?1 AND thread_id = ?2",
    );
    expect(marker.get(actorUserId(reader)!, source.thread.id)).toMatchObject({
      last_read_post_id: posts[3]!.id,
      last_read_position: 3,
    });
    expect(marker.get(actorUserId(reader)!, split.thread.id)).toMatchObject({
      last_read_post_id: posts[4]!.id,
      last_read_position: 0,
    });
    await execute(ctx, threadsMergeOp, moderator, {
      threadId: source.thread.id,
      sourceThreadIds: [split.thread.id],
    });
    expect(marker.get(actorUserId(reader)!, source.thread.id)).toMatchObject({
      last_read_post_id: posts[4]!.id,
      last_read_position: 4,
    });
  });

  test("forum deletion and restoration events include both content states", async () => {
    const { ctx, node, author, moderator } = setup();
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "States",
      body: "First",
    });
    const reply = await execute(ctx, postsCreateOp, author, {
      threadId: thread.thread.id,
      body: "Reply",
    });
    await execute(ctx, postsDeleteOp, moderator, { postId: reply.id });
    await execute(ctx, postsRestoreOp, moderator, { postId: reply.id });
    await execute(ctx, threadsDeleteOp, moderator, { threadId: thread.thread.id });
    await execute(ctx, threadsRestoreOp, moderator, { threadId: thread.thread.id });
    const events = ctx.sqlite
      .prepare<{ type: string; payload: string }, []>(
        "SELECT type, payload FROM domain_events WHERE type IN ('content.deleted', 'content.state_changed') ORDER BY id",
      )
      .all();
    expect(events.map(({ type, payload }) => ({ type, ...JSON.parse(payload) }))).toEqual([
      expect.objectContaining({
        type: "content.deleted",
        previousState: "visible",
        state: "deleted",
      }),
      expect.objectContaining({
        type: "content.state_changed",
        previousState: "deleted",
        state: "visible",
      }),
      expect.objectContaining({
        type: "content.deleted",
        previousState: "visible",
        state: "deleted",
      }),
      expect.objectContaining({
        type: "content.state_changed",
        previousState: "deleted",
        state: "visible",
      }),
    ]);
  });

  test("merged tombstones are absent from moderation targets and reports", async () => {
    const { ctx, node, author, moderator } = setup();
    const target = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Target",
      body: "First",
    });
    const source = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Source",
      body: "First",
    });
    await execute(ctx, threadsMergeOp, moderator, {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
    });
    const tombstone = { type: "thread" as const, id: source.thread.id };
    expect(() => moderateContent(ctx, moderator, tombstone, "visible")).toThrow(NotFoundError);
    expect(() => bulkModerate(ctx, moderator, [tombstone], "lock")).toThrow(NotFoundError);
  });

  test("pending transfer guards both ends and resumes without stranding posts", async () => {
    const { ctx, node, author, moderator } = setup();
    const make = async (title: string) =>
      execute(ctx, threadsCreateOp, author, { nodeId: node.id, title, body: "Body" });
    const target = await make("Target");
    const middle = await make("Middle");
    const source = await make("Source");
    const insert = ctx.sqlite.prepare(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'visible', ?4)",
    );
    const body = ctx.sqlite.prepare(
      "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'x', '<p>x</p>')",
    );
    for (let position = 1; position <= 501; position++)
      body.run(
        insert.run(source.thread.id, actorUserId(author)!, position, ctx.now() + position)
          .lastInsertRowid,
      );
    ctx.sqlite.prepare("UPDATE threads SET reply_count = 501 WHERE id = ?1").run(source.thread.id);
    ctx.sqlite.prepare("UPDATE nodes SET post_count = post_count + 501 WHERE id = ?1").run(node.id);
    ctx.sqlite
      .prepare("UPDATE users SET post_count = post_count + 501 WHERE id = ?1")
      .run(actorUserId(author)!);
    await execute(ctx, threadsMergeOp, moderator, {
      threadId: middle.thread.id,
      sourceThreadIds: [source.thread.id],
    });
    const conflict = "This thread is being reorganized; try again shortly";
    for (const run of [
      () =>
        execute(ctx, threadsMergeOp, moderator, {
          threadId: target.thread.id,
          sourceThreadIds: [middle.thread.id],
        }),
      () =>
        execute(ctx, threadsSplitOp, moderator, {
          threadId: middle.thread.id,
          postIds: [middle.post.id],
          title: "Split",
          nodeId: node.id,
        }),
      () => execute(ctx, threadsMoveOp, moderator, { threadId: middle.thread.id, nodeId: node.id }),
      () => execute(ctx, threadsDeleteOp, moderator, { threadId: middle.thread.id }),
      () => execute(ctx, threadsRestoreOp, moderator, { threadId: middle.thread.id }),
    ])
      await expect(run()).rejects.toThrow(conflict);
    await runDueJobs(ctx);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM posts WHERE thread_id = ?1")
        .get(source.thread.id)?.n,
    ).toBe(0);
    const tombstone = ctx.sqlite
      .prepare<
        {
          first_post_id: number | null;
          reply_count: number;
          last_post_id: number | null;
          last_post_at: number;
          last_poster_id: number;
          created_at: number;
          user_id: number;
        },
        [number]
      >(
        "SELECT first_post_id, reply_count, last_post_id, last_post_at, last_poster_id, created_at, user_id FROM threads WHERE id = ?1",
      )
      .get(source.thread.id)!;
    expect(tombstone).toMatchObject({
      first_post_id: null,
      reply_count: 0,
      last_post_id: null,
      last_post_at: tombstone.created_at,
      last_poster_id: tombstone.user_id,
    });

    const splitSource = await make("Split source");
    for (let position = 1; position <= 501; position++)
      body.run(
        insert.run(splitSource.thread.id, actorUserId(author)!, position, ctx.now() + position)
          .lastInsertRowid,
      );
    ctx.sqlite
      .prepare("UPDATE threads SET reply_count = 501 WHERE id = ?1")
      .run(splitSource.thread.id);
    ctx.sqlite.prepare("UPDATE nodes SET post_count = post_count + 501 WHERE id = ?1").run(node.id);
    ctx.sqlite
      .prepare("UPDATE users SET post_count = post_count + 501 WHERE id = ?1")
      .run(actorUserId(author)!);
    const split = await execute(ctx, threadsSplitOp, moderator, {
      threadId: splitSource.thread.id,
      fromPosition: 1,
      title: "New",
      nodeId: node.id,
    });
    await expect(
      execute(ctx, threadsMergeOp, moderator, {
        threadId: target.thread.id,
        sourceThreadIds: [split.thread.id],
      }),
    ).rejects.toThrow(conflict);
    await runDueJobs(ctx);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM posts WHERE thread_id = ?1")
        .get(split.thread.id)?.n,
    ).toBe(501);
  });

  test("failed transfer jobs keep guards and moderator retries resume remaining chunks", async () => {
    const { ctx, node, author, moderator } = setup();
    const target = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Target",
      body: "Body",
    });
    const source = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Source",
      body: "Body",
    });
    const insert = ctx.sqlite.prepare(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'visible', ?4)",
    );
    const body = ctx.sqlite.prepare(
      "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'x', '<p>x</p>')",
    );
    for (let i = 1; i <= 1001; i++)
      body.run(
        insert.run(source.thread.id, actorUserId(author)!, i, ctx.now() + i).lastInsertRowid,
      );
    ctx.sqlite.prepare("UPDATE threads SET reply_count = 1001 WHERE id = ?1").run(source.thread.id);
    ctx.sqlite
      .prepare("UPDATE nodes SET post_count = post_count + 1001 WHERE id = ?1")
      .run(node.id);
    ctx.sqlite
      .prepare("UPDATE users SET post_count = post_count + 1001 WHERE id = ?1")
      .run(actorUserId(author)!);
    await execute(ctx, threadsMergeOp, moderator, {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
    });
    await runDueJobs(ctx, { limit: 1 });
    const pending = ctx.sqlite
      .prepare<{ id: number }, []>(
        "SELECT id FROM jobs WHERE type = 'forums.merge' AND status = 'pending' ORDER BY id DESC LIMIT 1",
      )
      .get()!;
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'running', attempts = 5, locked_until = 0 WHERE id = ?1")
      .run(pending.id);
    // The lease of its last attempt expires: the queue marks it failed.
    await runDueJobs(ctx, { limit: 1 });
    await expect(
      execute(ctx, postsCreateOp, author, { threadId: target.thread.id, body: "Blocked" }),
    ).rejects.toThrow("This thread is being reorganized; try again shortly");
    const retry = await execute(ctx, threadsMergeOp, moderator, {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
    });
    expect(retry.completed).toBe(false);
    await runDueJobs(ctx);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM posts WHERE thread_id = ?1")
        .get(source.thread.id)!.n,
    ).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM jobs WHERE type IN ('forums.merge', 'forums.mergeFinalize') AND status = 'failed'",
        )
        .get()!.n,
    ).toBe(0);
  });

  test("failed split resumes the original new thread", async () => {
    const { ctx, node, author, moderator } = setup();
    const source = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Source",
      body: "Body",
    });
    const insert = ctx.sqlite.prepare(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'visible', ?4)",
    );
    const body = ctx.sqlite.prepare(
      "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'x', '<p>x</p>')",
    );
    for (let i = 1; i <= 1001; i++)
      body.run(
        insert.run(source.thread.id, actorUserId(author)!, i, ctx.now() + i).lastInsertRowid,
      );
    ctx.sqlite.prepare("UPDATE threads SET reply_count = 1001 WHERE id = ?1").run(source.thread.id);
    ctx.sqlite
      .prepare("UPDATE nodes SET post_count = post_count + 1001 WHERE id = ?1")
      .run(node.id);
    ctx.sqlite
      .prepare("UPDATE users SET post_count = post_count + 1001 WHERE id = ?1")
      .run(actorUserId(author)!);
    const request = {
      threadId: source.thread.id,
      fromPosition: 1,
      title: "Moved",
      nodeId: node.id,
    };
    const split = await execute(ctx, threadsSplitOp, moderator, request);
    await runDueJobs(ctx, { limit: 1 });
    const pending = ctx.sqlite
      .prepare<{ id: number }, []>(
        "SELECT id FROM jobs WHERE type = 'forums.split' AND status = 'pending' ORDER BY id DESC LIMIT 1",
      )
      .get()!;
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'running', attempts = 5, locked_until = 0 WHERE id = ?1")
      .run(pending.id);
    await runDueJobs(ctx, { limit: 1 });
    const retry = await execute(ctx, threadsSplitOp, moderator, request);
    expect(retry.thread.id).toBe(split.thread.id);
    await runDueJobs(ctx);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM posts WHERE thread_id = ?1")
        .get(split.thread.id)!.n,
    ).toBe(1001);
  });

  test("a 500-post merge clears the tombstone first post", async () => {
    const { ctx, node, author, moderator } = setup();
    const target = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Target",
      body: "Body",
    });
    const source = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Source",
      body: "Body",
    });
    const insert = ctx.sqlite.prepare(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'visible', ?4)",
    );
    const body = ctx.sqlite.prepare(
      "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'x', '<p>x</p>')",
    );
    for (let i = 1; i < 500; i++)
      body.run(
        insert.run(source.thread.id, actorUserId(author)!, i, ctx.now() + i).lastInsertRowid,
      );
    ctx.sqlite.prepare("UPDATE threads SET reply_count = 499 WHERE id = ?1").run(source.thread.id);
    ctx.sqlite.prepare("UPDATE nodes SET post_count = post_count + 499 WHERE id = ?1").run(node.id);
    ctx.sqlite
      .prepare("UPDATE users SET post_count = post_count + 499 WHERE id = ?1")
      .run(actorUserId(author)!);
    await execute(ctx, threadsMergeOp, moderator, {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
    });
    await runDueJobs(ctx);
    expect(
      ctx.sqlite
        .prepare<{ first_post_id: number | null }, [number]>(
          "SELECT first_post_id FROM threads WHERE id = ?1",
        )
        .get(source.thread.id)?.first_post_id,
    ).toBeNull();
  });

  test("a permanently failing transfer records an audit entry and remains retryable", async () => {
    const { ctx, node, author, moderator } = setup();
    const target = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Target",
      body: "Body",
    });
    const source = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Source",
      body: "Body",
    });
    const insert = ctx.sqlite.prepare(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'visible', ?4)",
    );
    const body = ctx.sqlite.prepare(
      "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'x', '<p>x</p>')",
    );
    for (let i = 1; i <= 501; i++)
      body.run(
        insert.run(source.thread.id, actorUserId(author)!, i, ctx.now() + i).lastInsertRowid,
      );
    ctx.sqlite.prepare("UPDATE threads SET reply_count = 501 WHERE id = ?1").run(source.thread.id);
    ctx.sqlite.prepare("UPDATE nodes SET post_count = post_count + 501 WHERE id = ?1").run(node.id);
    ctx.sqlite
      .prepare("UPDATE users SET post_count = post_count + 501 WHERE id = ?1")
      .run(actorUserId(author)!);
    await execute(ctx, threadsMergeOp, moderator, {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
    });
    ctx.sqlite.prepare("UPDATE threads SET state = 'visible' WHERE id = ?1").run(source.thread.id);
    for (let attempt = 0; attempt < 5; attempt++) {
      ctx.sqlite
        .prepare("UPDATE jobs SET run_at = ?1 WHERE type = 'forums.merge' AND status = 'pending'")
        .run(ctx.now());
      await runDueJobs(ctx, { limit: 1 });
    }
    expect(
      ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM jobs WHERE type = 'forums.merge' AND status = 'failed'",
        )
        .get()!.n,
    ).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM moderator_log WHERE action = 'thread.transfer.failed' AND target_id = ?1",
        )
        .get(target.thread.id)!.n,
    ).toBe(1);
    ctx.sqlite.prepare("UPDATE threads SET state = 'deleted' WHERE id = ?1").run(source.thread.id);
    await execute(ctx, threadsMergeOp, moderator, {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
    });
    await runDueJobs(ctx);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM posts WHERE thread_id = ?1")
        .get(source.thread.id)!.n,
    ).toBe(0);
  });
  test("transfer hot lookups use indexes", () => {
    const { ctx } = setup();
    expectNoTableScan(
      ctx,
      "SELECT id FROM jobs INDEXED BY jobs_status_run_at WHERE type = 'forums.split' AND status IN ('pending', 'running', 'failed') AND json_extract(payload, '$.targetId') = ?1 LIMIT 1",
      [1],
    );
    expectNoTableScan(
      ctx,
      "SELECT id FROM jobs INDEXED BY jobs_status_run_at WHERE type IN ('forums.merge', 'forums.mergeFinalize') AND status IN ('pending', 'running', 'failed') AND json_extract(payload, '$.targetId') = ?1 LIMIT 1",
      [1],
    );
    expectNoTableScan(
      ctx,
      "SELECT id, position, user_id, state, created_at FROM posts WHERE thread_id = ?1 ORDER BY position LIMIT ?2",
      [1, 500],
    );
    expectNoTableScan(
      ctx,
      "SELECT id, position, user_id, state, created_at FROM posts WHERE thread_id = ?1 AND position >= ?2 ORDER BY position LIMIT ?3",
      [1, 1, 500],
    );
    expectNoTableScan(
      ctx,
      "SELECT id, position, user_id, state, created_at FROM posts WHERE thread_id = ?1 AND position BETWEEN ?2 AND ?4 ORDER BY position LIMIT ?3",
      [1, 1, 500, 1000],
    );
    expectNoTableScan(ctx, "SELECT id FROM jobs WHERE unique_key = ?1", ["forums.merge.1.2"]);
    expectNoTableScan(ctx, "SELECT payload FROM jobs WHERE unique_key = ?1 AND status = 'failed'", [
      "forums.split.1",
    ]);
    expectNoTableScan(
      ctx,
      "SELECT other_thread_id FROM thread_transfers WHERE thread_id = ?1",
      [1],
    );
    expectNoTableScan(
      ctx,
      "SELECT position FROM posts WHERE thread_id = ?1 ORDER BY position LIMIT 1",
      [1],
    );
    expectNoTableScan(
      ctx,
      "SELECT id, position FROM posts WHERE thread_id = ?1 AND position < 0 ORDER BY position DESC LIMIT 500",
      [1],
    );
  });
  test("node rules approve or forbid posts, while a moderator bypasses them", async () => {
    const { ctx, node, author, moderator, admin } = setup();
    await execute(ctx, nodesUpdateOp, admin, {
      nodeId: node.id,
      settings: { requireThreadApproval: true },
    });
    const held = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Held",
      body: "Body",
    });
    expect(held.thread.state).toBe("moderated");
    const bypassed = await execute(ctx, threadsCreateOp, moderator, {
      nodeId: node.id,
      title: "Allowed",
      body: "Body",
    });
    expect(bypassed.thread.state).toBe("visible");
    await execute(ctx, nodesUpdateOp, admin, {
      nodeId: node.id,
      settings: { requireReplyApproval: true },
    });
    expect(
      (await execute(ctx, postsCreateOp, author, { threadId: bypassed.thread.id, body: "Reply" }))
        .state,
    ).toBe("moderated");
    await execute(ctx, nodesUpdateOp, admin, { nodeId: node.id, settings: { isReadOnly: true } });
    await expect(
      execute(ctx, postsCreateOp, author, { threadId: bypassed.thread.id, body: "No" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      (await execute(ctx, postsCreateOp, moderator, { threadId: bypassed.thread.id, body: "Yes" }))
        .state,
    ).toBe("visible");
  });

  test("node account age and post count limits reject new members", async () => {
    const { ctx, node, author, moderator, admin } = setup();
    await execute(ctx, nodesUpdateOp, admin, {
      nodeId: node.id,
      settings: { minAccountAgeDays: 7 },
    });
    await expect(
      execute(ctx, threadsCreateOp, author, { nodeId: node.id, title: "Too new", body: "Body" }),
    ).rejects.toThrow("too new");
    await execute(ctx, nodesUpdateOp, admin, {
      nodeId: node.id,
      settings: { minAccountAgeDays: 0, minPostCount: 10 },
    });
    await expect(
      execute(ctx, threadsCreateOp, author, { nodeId: node.id, title: "Too few", body: "Body" }),
    ).rejects.toThrow("more posts");
    expect(
      (
        await execute(ctx, threadsCreateOp, moderator, {
          nodeId: node.id,
          title: "Bypass",
          body: "Body",
        })
      ).thread.state,
    ).toBe("visible");
  });

  test("node moderator entries grant inherited permissions and removal revokes them", async () => {
    const { ctx, node, author, admin } = setup();
    const child = insertNode(ctx, { parentId: node.id });
    invalidate(ctx, "node_tree");
    await expect(
      execute(ctx, nodesSetModeratorOp, author, { nodeId: node.id, userId: actorUserId(author)! }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await execute(ctx, nodesSetModeratorOp, admin, {
      nodeId: node.id,
      userId: actorUserId(author)!,
    });
    const grant = ctx.sqlite
      .prepare<{ value: number }, [number, number]>(
        "SELECT e.value FROM permission_entries e JOIN permission_definitions d ON d.id = e.permission_id WHERE e.node_id = ?1 AND e.user_id = ?2 AND d.key = 'forum.viewLog'",
      )
      .get(node.id, actorUserId(author)!);
    expect(grant?.value).toBe(1);
    expect(can(ctx, author, "forum.viewLog", { nodeId: child.id })).toBe(true);
    await execute(ctx, nodesSetModeratorOp, admin, {
      nodeId: node.id,
      userId: actorUserId(author)!,
      remove: true,
    });
    expect(
      ctx.sqlite
        .prepare("SELECT 1 FROM permission_entries WHERE node_id = ?1 AND user_id = ?2")
        .get(node.id, actorUserId(author)!),
    ).toBeNull();
    expect(can(ctx, author, "forum.viewLog", { nodeId: child.id })).toBe(false);
    expect(child.id).toBeGreaterThan(node.id);
  });

  test("node moderator add and remove preserve deliberate denials", async () => {
    const { ctx, node, author, admin } = setup();
    const userId = actorUserId(author)!;
    await execute(ctx, nodesSetModeratorOp, admin, { nodeId: node.id, userId });
    ctx.sqlite
      .prepare(
        "UPDATE permission_entries SET value = 0 WHERE node_id = ?1 AND user_id = ?2 AND permission_id = (SELECT id FROM permission_definitions WHERE key = 'forum.viewLog')",
      )
      .run(node.id, userId);
    ctx.sqlite
      .prepare(
        "UPDATE permission_entries SET value = -1 WHERE node_id = ?1 AND user_id = ?2 AND permission_id = (SELECT id FROM permission_definitions WHERE key = 'forum.bypassNodeRules')",
      )
      .run(node.id, userId);
    await execute(ctx, nodesSetModeratorOp, admin, { nodeId: node.id, userId });
    await execute(ctx, nodesSetModeratorOp, admin, { nodeId: node.id, userId, remove: true });
    const entries = ctx.sqlite
      .prepare<{ key: string; value: number }, [number, number]>(
        "SELECT d.key, e.value FROM permission_entries e JOIN permission_definitions d ON d.id = e.permission_id WHERE e.node_id = ?1 AND e.user_id = ?2",
      )
      .all(node.id, userId);
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({ key: "forum.viewLog", value: 0 });
    expect(entries).toContainEqual({ key: "forum.bypassNodeRules", value: -1 });
  });

  test("merge redirects tombstones, moves markers and watches, and preserves positions", async () => {
    const { ctx, node, otherNode, author, moderator } = setup();
    const target = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Target",
      body: "Target body",
    });
    const source = await execute(ctx, threadsCreateOp, author, {
      nodeId: otherNode.id,
      title: "Source",
      body: "Source body",
    });
    const reply = await execute(ctx, postsCreateOp, author, {
      threadId: source.thread.id,
      body: "Reply",
    });
    const report = createReport(ctx, author, { type: "post", id: reply.id }, "Review this");
    await execute(ctx, getOperation("threadBans.create"), moderator, {
      threadId: source.thread.id,
      userId: actorUserId(author)!,
      reason: "Pause",
    });
    ctx.sqlite
      .prepare(
        "INSERT INTO notifications (user_id, type, content_type, content_id, thread_id, created_at, updated_at) VALUES (?1, 'reply', 'thread', ?2, ?2, ?3, ?3)",
      )
      .run(actorUserId(author)!, source.thread.id, ctx.now());
    ctx.sqlite
      .prepare(
        "INSERT INTO thread_watches (user_id, thread_id, email, created_at) VALUES (?1, ?2, 1, ?3)",
      )
      .run(actorUserId(author)!, source.thread.id, ctx.now());
    const result = await execute(ctx, threadsMergeOp, moderator, {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
      reason: "Duplicate",
      notify: false,
      message: "See the main thread",
    });
    expect(result.completed).toBe(true);
    expect(
      (await execute(ctx, threadsGetOp, GUEST, { threadId: source.thread.id })).thread.id,
    ).toBe(target.thread.id);
    expect(
      (await execute(ctx, threadsGetOp, GUEST, { threadId: source.thread.id })).seo.redirect,
    ).toBe(true);
    expect(
      (await execute(ctx, getOperation("seo.thread"), GUEST, { threadId: source.thread.id }))
        .redirect,
    ).toBe(true);
    expect(
      (await execute(ctx, threadsListOp, moderator, { nodeId: otherNode.id })).items,
    ).toHaveLength(0);
    expect(
      ctx.sqlite
        .prepare<{ position: number }, [number]>("SELECT position FROM posts WHERE id = ?1")
        .get(reply.id)?.position,
    ).toBe(2);
    expect(
      ctx.sqlite
        .prepare("SELECT 1 FROM thread_watches WHERE thread_id = ?1 AND user_id = ?2")
        .get(target.thread.id, actorUserId(author)!),
    ).toBeTruthy();
    expect(
      ctx.sqlite
        .prepare("SELECT 1 FROM thread_bans WHERE thread_id = ?1 AND user_id = ?2")
        .get(target.thread.id, actorUserId(author)!),
    ).toBeTruthy();
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT post_count AS n FROM nodes WHERE id = ?1")
        .get(otherNode.id)?.n,
    ).toBe(0);
    expect(mergeThreadChunk(ctx, target.thread.id, source.thread.id, 1, true)).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT post_count AS n FROM nodes WHERE id = ?1")
        .get(node.id)?.n,
    ).toBe(3);
    expect(
      ctx.sqlite
        .prepare("SELECT 1 FROM thread_reads WHERE thread_id = ?1 AND user_id = ?2")
        .get(source.thread.id, actorUserId(author)!),
    ).toBeNull();
    expect(
      ctx.sqlite
        .prepare<{ last_read_position: number }, [number, number]>(
          "SELECT last_read_position FROM thread_reads WHERE thread_id = ?1 AND user_id = ?2",
        )
        .get(target.thread.id, actorUserId(author)!)?.last_read_position,
    ).toBe(2);
    const event = ctx.sqlite
      .prepare<{ payload: string }, [number]>(
        "SELECT payload FROM domain_events WHERE type = 'moderation.action' AND target_id = ?1 ORDER BY id DESC LIMIT 1",
      )
      .get(source.thread.id);
    expect(JSON.parse(event!.payload)).toMatchObject({
      notify: false,
      message: "See the main thread",
      reason: "Duplicate",
    });
    expect(
      ctx.sqlite
        .prepare<{ node_id: number }, [number]>("SELECT node_id FROM report_groups WHERE id = ?1")
        .get(report.groupId)?.node_id,
    ).toBe(node.id);
    expect(
      ctx.sqlite
        .prepare<{ thread_id: number; content_id: number }, [number]>(
          "SELECT thread_id, content_id FROM notifications WHERE user_id = ?1 AND type = 'reply'",
        )
        .get(actorUserId(author)!),
    ).toMatchObject({ thread_id: target.thread.id, content_id: target.thread.id });
    expect(
      ctx.sqlite
        .prepare(
          "SELECT rowid FROM search_fts WHERE rowid = ?1 AND search_fts MATCH 'title:Source'",
        )
        .get(source.post.id),
    ).toBeNull();
  });

  test("large merge resumes from queued chunks", async () => {
    const { ctx, node, author, moderator } = setup();
    const target = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Target",
      body: "Body",
    });
    const source = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Source",
      body: "Body",
    });
    const insert = ctx.sqlite.prepare(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'visible', ?4)",
    );
    const body = ctx.sqlite.prepare(
      "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'x', '<p>x</p>')",
    );
    for (let position = 1; position <= 2500; position++) {
      const id = Number(
        insert.run(source.thread.id, actorUserId(author)!, position, ctx.now()).lastInsertRowid,
      );
      body.run(id);
    }
    ctx.sqlite
      .prepare(
        "UPDATE threads SET reply_count = 2500, last_post_id = (SELECT id FROM posts WHERE thread_id = ?1 ORDER BY position DESC LIMIT 1) WHERE id = ?1",
      )
      .run(source.thread.id);
    ctx.sqlite
      .prepare("UPDATE nodes SET post_count = post_count + 2500 WHERE id = ?1")
      .run(node.id);
    ctx.sqlite
      .prepare("UPDATE users SET post_count = post_count + 2500 WHERE id = ?1")
      .run(actorUserId(author)!);
    const result = await execute(ctx, threadsMergeOp, moderator, {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
    });
    expect(result.completed).toBe(false);
    await expect(
      execute(ctx, postsCreateOp, author, { threadId: target.thread.id, body: "Wait" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM posts WHERE thread_id = ?1")
        .get(source.thread.id)?.n,
    ).toBe(2501);
    await runDueJobs(ctx);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM posts WHERE thread_id = ?1")
        .get(source.thread.id)?.n,
    ).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT reply_count AS n FROM threads WHERE id = ?1")
        .get(target.thread.id)?.n,
    ).toBe(2501);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT post_count AS n FROM nodes WHERE id = ?1")
        .get(node.id)?.n,
    ).toBe(2502);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT post_count AS n FROM users WHERE id = ?1")
        .get(actorUserId(author)!)?.n,
    ).toBe(2502);
    expect(mergeThreadChunk(ctx, target.thread.id, source.thread.id, 1, true)).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT count(*) AS n FROM posts WHERE thread_id = ?1")
        .get(target.thread.id)?.n,
    ).toBe(2502);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM (SELECT position FROM posts WHERE thread_id = ?1 GROUP BY position HAVING count(*) > 1)",
        )
        .get(target.thread.id)?.n,
    ).toBe(0);
  });

  test("large merge and split recount hidden posts and authors after creation-order renumbering", async () => {
    const { ctx, node, author, moderator } = setup();
    const second = userActor(insertUser(ctx));
    const target = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Target",
      body: "Body",
    });
    const source = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Source",
      body: "Body",
    });
    const add = ctx.sqlite.prepare(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    );
    const body = ctx.sqlite.prepare(
      "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'body', '<p>body</p>')",
    );
    const base = ctx.now() + 100;
    for (let i = 1; i <= 600; i++) {
      body.run(
        add.run(target.thread.id, actorUserId(second)!, i, "visible", base + i * 2).lastInsertRowid,
      );
      body.run(
        add.run(
          source.thread.id,
          i % 2 ? actorUserId(author)! : actorUserId(second)!,
          i,
          i % 6 === 0 ? "deleted" : "visible",
          base + i * 2 + 1,
        ).lastInsertRowid,
      );
    }
    ctx.sqlite
      .prepare(
        "UPDATE threads SET reply_count = ?2, last_post_id = (SELECT id FROM posts WHERE thread_id = ?1 AND state = 'visible' ORDER BY position DESC LIMIT 1), last_post_at = (SELECT created_at FROM posts WHERE thread_id = ?1 AND state = 'visible' ORDER BY position DESC LIMIT 1) WHERE id = ?1",
      )
      .run(target.thread.id, 600);
    ctx.sqlite
      .prepare(
        "UPDATE threads SET state = 'deleted', reply_count = 500, last_post_id = (SELECT id FROM posts WHERE thread_id = ?1 AND state = 'visible' ORDER BY position DESC LIMIT 1), last_post_at = (SELECT created_at FROM posts WHERE thread_id = ?1 AND state = 'visible' ORDER BY position DESC LIMIT 1) WHERE id = ?1",
      )
      .run(source.thread.id);
    ctx.sqlite
      .prepare(
        "UPDATE nodes SET thread_count = thread_count - 1, post_count = post_count + 599 WHERE id = ?1",
      )
      .run(node.id);
    ctx.sqlite
      .prepare("UPDATE users SET post_count = post_count - 1 WHERE id = ?1")
      .run(actorUserId(author)!);
    ctx.sqlite
      .prepare("UPDATE users SET post_count = post_count + 600 WHERE id = ?1")
      .run(actorUserId(second)!);
    const sourceRead = ctx.sqlite
      .prepare<{ id: number }, [number]>(
        "SELECT id FROM posts WHERE thread_id = ?1 AND position = 450",
      )
      .get(source.thread.id)!.id;
    ctx.sqlite
      .prepare(
        "INSERT INTO thread_reads (user_id, thread_id, last_read_post_id, last_read_position, read_at) VALUES (?1, ?2, ?3, 450, ?4)",
      )
      .run(actorUserId(second)!, source.thread.id, sourceRead, ctx.now());
    const merged = await execute(ctx, threadsMergeOp, moderator, {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
    });
    expect(merged.completed).toBe(false);
    await runDueJobs(ctx);
    const ordered = ctx.sqlite
      .prepare<{ id: number; position: number; created_at: number }, [number]>(
        "SELECT id, position, created_at FROM posts WHERE thread_id = ?1 ORDER BY position",
      )
      .all(target.thread.id);
    expect(ordered.map((row) => row.position)).toEqual(Array.from({ length: 1202 }, (_, i) => i));
    expect(ordered.map((row) => row.id)).toEqual(
      [...ordered].sort((a, b) => a.created_at - b.created_at || a.id - b.id).map((row) => row.id),
    );
    const read = ctx.sqlite
      .prepare<{ last_read_position: number }, [number, number]>(
        "SELECT last_read_position FROM thread_reads WHERE user_id = ?1 AND thread_id = ?2",
      )
      .get(actorUserId(second)!, target.thread.id);
    expect(read?.last_read_position).toBe(ordered.find((row) => row.id === sourceRead)?.position);
    const recount = (threadIds: number[]) => {
      for (const id of threadIds) {
        const row = ctx.sqlite
          .prepare<{ reply_count: number }, [number]>(
            "SELECT reply_count FROM threads WHERE id = ?1",
          )
          .get(id)!;
        const visible = ctx.sqlite
          .prepare<{ n: number }, [number]>(
            "SELECT count(*) AS n FROM posts WHERE thread_id = ?1 AND state = 'visible'",
          )
          .get(id)!.n;
        expect(row.reply_count).toBe(Math.max(0, visible - 1));
      }
      const nodeCount = ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM posts p JOIN threads t ON t.id = p.thread_id WHERE t.node_id = ?1 AND t.state = 'visible' AND p.state = 'visible'",
        )
        .get(node.id)!.n;
      expect(
        ctx.sqlite
          .prepare<{ post_count: number }, [number]>("SELECT post_count FROM nodes WHERE id = ?1")
          .get(node.id)!.post_count,
      ).toBe(nodeCount);
      for (const userId of [actorUserId(author)!, actorUserId(second)!]) {
        const count = ctx.sqlite
          .prepare<{ n: number }, [number]>(
            "SELECT count(*) AS n FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.user_id = ?1 AND p.state = 'visible' AND t.state = 'visible'",
          )
          .get(userId)!.n;
        expect(
          ctx.sqlite
            .prepare<{ post_count: number }, [number]>("SELECT post_count FROM users WHERE id = ?1")
            .get(userId)!.post_count,
        ).toBe(count);
      }
    };
    recount([target.thread.id, source.thread.id]);
    const splitPosition = ordered.find(
      (row) =>
        row.position >= 600 &&
        row.id !== source.post.id &&
        ctx.sqlite
          .prepare<{ state: string }, [number]>("SELECT state FROM posts WHERE id = ?1")
          .get(row.id)?.state === "visible",
    )!.position;
    const split = await execute(ctx, threadsSplitOp, moderator, {
      threadId: target.thread.id,
      fromPosition: splitPosition,
      title: "Split",
      nodeId: node.id,
    });
    expect(split.completed).toBe(false);
    await runDueJobs(ctx);
    recount([target.thread.id, source.thread.id, split.thread.id]);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM threads WHERE node_id = ?1 AND state = 'visible'",
        )
        .get(node.id)!.n,
    ).toBe(
      ctx.sqlite
        .prepare<{ thread_count: number }, [number]>("SELECT thread_count FROM nodes WHERE id = ?1")
        .get(node.id)!.thread_count,
    );
  });

  test("split selected posts and a large range without changing source positions", async () => {
    const { ctx, node, otherNode, author, moderator } = setup();
    const source = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Source",
      body: "First",
    });
    const a = await execute(ctx, postsCreateOp, author, { threadId: source.thread.id, body: "A" });
    const b = await execute(ctx, postsCreateOp, author, { threadId: source.thread.id, body: "B" });
    const picked = await execute(ctx, threadsSplitOp, moderator, {
      threadId: source.thread.id,
      postIds: [b.id, a.id],
      title: "Picked",
      nodeId: otherNode.id,
    });
    expect(picked.completed).toBe(true);
    expect(
      ctx.sqlite
        .prepare(
          "SELECT rowid FROM search_fts WHERE rowid = ?1 AND search_fts MATCH 'title:Picked'",
        )
        .get(a.id),
    ).toBeTruthy();
    expect(
      ctx.sqlite
        .prepare<{ position: number }, [number]>("SELECT position FROM posts WHERE id = ?1")
        .get(a.id)?.position,
    ).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ position: number }, [number]>("SELECT position FROM posts WHERE id = ?1")
        .get(source.post.id)?.position,
    ).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT post_count AS n FROM nodes WHERE id = ?1")
        .get(otherNode.id)?.n,
    ).toBe(2);
    const insert = ctx.sqlite.prepare(
      "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'visible', ?4)",
    );
    const body = ctx.sqlite.prepare(
      "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'x', '<p>x</p>')",
    );
    for (let position = 3; position < 2103; position++) {
      const id = Number(
        insert.run(source.thread.id, actorUserId(author)!, position, ctx.now()).lastInsertRowid,
      );
      body.run(id);
    }
    ctx.sqlite
      .prepare(
        "UPDATE threads SET reply_count = 2100, last_post_id = (SELECT id FROM posts WHERE thread_id = ?1 ORDER BY position DESC LIMIT 1) WHERE id = ?1",
      )
      .run(source.thread.id);
    ctx.sqlite
      .prepare("UPDATE nodes SET post_count = post_count + 2100 WHERE id = ?1")
      .run(node.id);
    ctx.sqlite
      .prepare("UPDATE users SET post_count = post_count + 2100 WHERE id = ?1")
      .run(actorUserId(author)!);
    const ranged = await execute(ctx, threadsSplitOp, moderator, {
      threadId: source.thread.id,
      fromPosition: 3,
      title: "Range",
      nodeId: otherNode.id,
    });
    expect(ranged.completed).toBe(false);
    await expect(
      execute(ctx, postsCreateOp, author, { threadId: ranged.thread.id, body: "Wait" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const later = await execute(ctx, postsCreateOp, author, {
      threadId: source.thread.id,
      body: "Later",
    });
    await runDueJobs(ctx);
    expect(
      ctx.sqlite
        .prepare<{ thread_id: number }, [number]>("SELECT thread_id FROM posts WHERE id = ?1")
        .get(later.id)?.thread_id,
    ).toBe(source.thread.id);
    const positions = ctx.sqlite
      .prepare<{ position: number }, [number]>(
        "SELECT position FROM posts WHERE thread_id = ?1 ORDER BY position",
      )
      .all(ranged.thread.id)
      .map((row) => row.position);
    expect(positions.length).toBe(2100);
    expect(positions[0]).toBe(0);
    expect(positions.at(-1)).toBe(2099);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT reply_count AS n FROM threads WHERE id = ?1")
        .get(ranged.thread.id)?.n,
    ).toBe(2099);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT post_count AS n FROM nodes WHERE id = ?1")
        .get(node.id)?.n,
    ).toBe(2);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT post_count AS n FROM users WHERE id = ?1")
        .get(actorUserId(author)!)?.n,
    ).toBe(2104);
  });

  test("thread bans enforce hierarchy, expiry, and visibility", async () => {
    const { ctx, node, author, moderator, admin } = setup();
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Thread",
      body: "Body",
    });
    await expect(
      execute(ctx, getOperation("threadBans.create"), author, {
        threadId: thread.thread.id,
        userId: actorUserId(moderator)!,
        reason: "No",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      execute(ctx, getOperation("threadBans.create"), moderator, {
        threadId: thread.thread.id,
        userId: actorUserId(admin)!,
        reason: "No",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const ban = await execute(ctx, getOperation("threadBans.create"), moderator, {
      threadId: thread.thread.id,
      userId: actorUserId(author)!,
      reason: "Flood",
    });
    expect(ban.reason).toBe("Flood");
    await expect(
      execute(ctx, postsCreateOp, author, { threadId: thread.thread.id, body: "Blocked" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      (
        await execute(ctx, getOperation("threadBans.list"), moderator, {
          threadId: thread.thread.id,
        })
      ).items,
    ).toHaveLength(1);
    await execute(ctx, getOperation("threadBans.lift"), moderator, {
      threadId: thread.thread.id,
      userId: actorUserId(author)!,
    });
    const eventsBeforeNoop = ctx.sqlite
      .prepare<{ n: number }, []>(
        "SELECT count(*) AS n FROM domain_events WHERE type = 'member.thread_banned'",
      )
      .get()!.n;
    await execute(ctx, getOperation("threadBans.lift"), moderator, {
      threadId: thread.thread.id,
      userId: actorUserId(author)!,
    });
    expect(
      ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM domain_events WHERE type = 'member.thread_banned'",
        )
        .get()!.n,
    ).toBe(eventsBeforeNoop);
    expect(
      (
        await execute(ctx, getOperation("threadBans.list"), moderator, {
          threadId: thread.thread.id,
        })
      ).items,
    ).toHaveLength(0);
    await execute(ctx, getOperation("threadBans.create"), moderator, {
      threadId: thread.thread.id,
      userId: actorUserId(author)!,
      reason: "Temporary",
      expiresAt: new Date(ctx.now() + 1_000).toISOString(),
      notify: false,
      message: "Wait briefly",
    });
    ctx.clock.advance(1_001);
    expect(
      (await execute(ctx, postsCreateOp, author, { threadId: thread.thread.id, body: "Allowed" }))
        .state,
    ).toBe("visible");
    expect(
      (
        await execute(ctx, getOperation("threadBans.list"), moderator, {
          threadId: thread.thread.id,
        })
      ).items,
    ).toHaveLength(0);
    await expect(
      execute(ctx, getOperation("threadBans.list"), GUEST, { threadId: thread.thread.id }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  test("a merge chain run again after completion leaves positions, counters and guards intact", async () => {
    const { ctx, node, author, moderator } = setup();
    const reader = userActor(insertUser(ctx));
    const authorId = actorUserId(author)!;
    const target = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Target",
      body: "Body",
    });
    const source = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Source",
      body: "Body",
    });
    const start = ctx.now() + 1000;
    const targetPosts = addPosts(ctx, target.thread.id, authorId, 120, (i) => start + i * 10);
    const sourcePosts = addPosts(ctx, source.thread.id, authorId, 1200, (i) => start + i);
    const read = ctx.sqlite.prepare(
      "INSERT INTO thread_reads (user_id, thread_id, last_read_post_id, last_read_position, read_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    );
    read.run(actorUserId(reader)!, target.thread.id, targetPosts[59]!, 60, ctx.now());
    read.run(actorUserId(reader)!, source.thread.id, sourcePosts[599]!, 600, ctx.now());
    const merged = await execute(ctx, threadsMergeOp, moderator, {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
    });
    expect(merged.completed).toBe(false);
    const nextJob = ctx.sqlite.prepare<{ id: number; type: string; payload: string }, []>(
      "SELECT id, type, payload FROM jobs WHERE status = 'pending' AND type LIKE 'forums.%' ORDER BY run_at, id LIMIT 1",
    );
    const ran: { id: number; type: string; payload: string }[] = [];
    for (let guard = 0; guard < 100; guard++) {
      const job = nextJob.get();
      if (!job) break;
      ran.push(job);
      await runDueJobs(ctx, { limit: 1 });
    }
    expect(new Set(ran.map((job) => job.type))).toEqual(
      new Set(["forums.merge", "forums.mergeFinalize"]),
    );
    expectMergedInOrder(ctx, target.thread.id, target.post.id, 1322);
    expectCounters(ctx, node.id, [target.thread.id, source.thread.id], [authorId]);
    expect(ctx.sqlite.prepare("SELECT 1 FROM thread_transfers").get()).toBeNull();
    const marker = ctx.sqlite
      .prepare<{ last_read_post_id: number; last_read_position: number }, [number, number]>(
        "SELECT last_read_post_id, last_read_position FROM thread_reads WHERE user_id = ?1 AND thread_id = ?2",
      )
      .get(actorUserId(reader)!, target.thread.id)!;
    expect(marker.last_read_post_id).toBe(sourcePosts[599]!);
    expect(marker.last_read_position).toBe(
      ctx.sqlite
        .prepare<{ position: number }, [number]>("SELECT position FROM posts WHERE id = ?1")
        .get(sourcePosts[599]!)!.position,
    );

    // A second chain of the same jobs started after completion changes nothing.
    for (const job of ran) {
      const payload = JSON.parse(job.payload) as { targetId: number; sourceId?: number };
      enqueueJob(ctx, job.type, payload, {
        uniqueKey:
          job.type === "forums.merge"
            ? `forums.merge.${payload.targetId}.${payload.sourceId}`
            : `forums.mergeFinalize.${payload.targetId}`,
      });
      await runDueJobs(ctx, { limit: 1 });
    }
    expectMergedInOrder(ctx, target.thread.id, target.post.id, 1322);
    expectCounters(ctx, node.id, [target.thread.id, source.thread.id], [authorId]);

    // A later merge into the same target sets and clears its own guard.
    const later = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Later",
      body: "Body",
    });
    addPosts(ctx, later.thread.id, authorId, 600, (i) => start + 2000 + i);
    await execute(ctx, threadsMergeOp, moderator, {
      threadId: target.thread.id,
      sourceThreadIds: [later.thread.id],
    });
    const transfers = ctx.sqlite.prepare<{ n: number }, []>(
      "SELECT count(*) AS n FROM thread_transfers",
    );
    expect(transfers.get()!.n).toBe(2);
    await runDueJobs(ctx);
    expect(transfers.get()!.n).toBe(0);
    expectMergedInOrder(ctx, target.thread.id, target.post.id, 1923);
    expectCounters(ctx, node.id, [target.thread.id, later.thread.id], [authorId]);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM jobs WHERE type LIKE 'forums.%' AND status != 'done'",
        )
        .get()!.n,
    ).toBe(0);
  });

  test("a transfer chunk whose successor key is held rolls back and retries", async () => {
    const { ctx, node, author, moderator } = setup();
    const target = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Target",
      body: "Body",
    });
    const source = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Source",
      body: "Body",
    });
    addPosts(ctx, source.thread.id, actorUserId(author)!, 501, (i) => ctx.now() + i);
    await execute(ctx, threadsMergeOp, moderator, {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
    });
    const holder = enqueueJob(
      ctx,
      "test.hold",
      {},
      { runAt: ctx.now() + 86_400_000, uniqueKey: `forums.mergeFinalize.${target.thread.id}` },
    )!;
    await runDueJobs(ctx);
    const last = ctx.sqlite
      .prepare<{ status: string; attempts: number; last_error: string | null }, []>(
        "SELECT status, attempts, last_error FROM jobs WHERE type = 'forums.merge' ORDER BY id DESC LIMIT 1",
      )
      .get()!;
    expect(last).toMatchObject({ status: "pending", attempts: 1 });
    expect(last.last_error).toContain("already queued");
    expect(
      ctx.sqlite.prepare("SELECT 1 FROM jobs WHERE type = 'forums.mergeFinalize'").get(),
    ).toBeNull();
    ctx.sqlite.prepare("DELETE FROM jobs WHERE id = ?1").run(holder);
    ctx.clock.set(ctx.now() + 30_000);
    await runDueJobs(ctx);
    expect(ctx.sqlite.prepare("SELECT 1 FROM thread_transfers").get()).toBeNull();
    expectMergedInOrder(ctx, target.thread.id, target.post.id, 503);
  });

  test("failed merge jobs record the failure, retry with their own payloads and free the target", async () => {
    const { ctx, node, author, moderator } = setup();
    const authorId = actorUserId(author)!;
    const target = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Target",
      body: "Body",
    });
    const failRunning = async (type: string) => {
      const job = ctx.sqlite
        .prepare<{ id: number }, [string]>(
          "SELECT id FROM jobs WHERE type = ?1 AND status = 'pending' ORDER BY id DESC LIMIT 1",
        )
        .get(type)!;
      // The lease of its last attempt expires: the queue gives up on it.
      ctx.sqlite
        .prepare("UPDATE jobs SET status = 'running', attempts = 5, locked_until = 0 WHERE id = ?1")
        .run(job.id);
      await runDueJobs(ctx, { limit: 1 });
      return job.id;
    };
    const failedAt = ctx.sqlite.prepare<{ failed_at: number | null }, [number]>(
      "SELECT failed_at FROM thread_transfers WHERE thread_id = ?1",
    );
    let posts = 1;
    for (const failing of ["forums.merge", "forums.mergeFinalize"]) {
      const source = await execute(ctx, threadsCreateOp, author, {
        nodeId: node.id,
        title: failing,
        body: "Body",
      });
      addPosts(ctx, source.thread.id, authorId, 501, (i) => ctx.now() + i);
      posts += 502;
      await execute(ctx, threadsMergeOp, moderator, {
        threadId: target.thread.id,
        sourceThreadIds: [source.thread.id],
      });
      if (failing === "forums.mergeFinalize")
        while (
          !ctx.sqlite
            .prepare(
              "SELECT 1 FROM jobs WHERE type = 'forums.mergeFinalize' AND status = 'pending'",
            )
            .get()
        )
          await runDueJobs(ctx, { limit: 1 });
      else await runDueJobs(ctx, { limit: 1 });
      const failedId = await failRunning(failing);
      expect(
        ctx.sqlite
          .prepare<{ status: string; unique_key: string | null }, [number]>(
            "SELECT status, unique_key FROM jobs WHERE id = ?1",
          )
          .get(failedId),
      ).toEqual({
        status: "failed",
        unique_key:
          failing === "forums.merge"
            ? `forums.merge.${target.thread.id}.${source.thread.id}`
            : `forums.mergeFinalize.${target.thread.id}`,
      });
      expect(failedAt.get(target.thread.id)?.failed_at).toBeNumber();
      expect(failedAt.get(source.thread.id)?.failed_at).toBeNumber();
      await expect(
        execute(ctx, postsCreateOp, author, { threadId: target.thread.id, body: "Blocked" }),
      ).rejects.toThrow("This thread is being reorganized; try again shortly");
      const retry = await execute(ctx, threadsMergeOp, moderator, {
        threadId: target.thread.id,
        sourceThreadIds: [source.thread.id],
      });
      expect(retry.completed).toBe(false);
      await runDueJobs(ctx);
      expect(ctx.sqlite.prepare("SELECT 1 FROM thread_transfers").get()).toBeNull();
      expectMergedInOrder(ctx, target.thread.id, target.post.id, posts);
      expectCounters(ctx, node.id, [target.thread.id, source.thread.id], [authorId]);
    }
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM moderator_log WHERE action = 'thread.transfer.failed' AND target_id = ?1",
        )
        .get(target.thread.id)!.n,
    ).toBe(2);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT count(*) AS n FROM jobs WHERE type LIKE 'forums.%' AND status != 'done'",
        )
        .get()!.n,
    ).toBe(0);
    const other = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Other",
      body: "Body",
    });
    await execute(ctx, threadsMergeOp, moderator, {
      threadId: target.thread.id,
      sourceThreadIds: [other.thread.id],
    });
    await runDueJobs(ctx);
    expect(ctx.sqlite.prepare("SELECT 1 FROM thread_transfers").get()).toBeNull();
    expectMergedInOrder(ctx, target.thread.id, target.post.id, posts + 1);
  });

  test("the merge finalizer rejects a payload without its stream bounds", async () => {
    const { ctx, node, author } = setup();
    const target = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Target",
      body: "Body",
    });
    enqueueJob(
      ctx,
      "forums.mergeFinalize",
      { targetId: target.thread.id, sourceIds: [target.thread.id + 1], moderatorId: null },
      { uniqueKey: `forums.mergeFinalize.${target.thread.id}` },
    );
    await runDueJobs(ctx);
    const job = ctx.sqlite
      .prepare<{ status: string; last_error: string | null }, []>(
        "SELECT status, last_error FROM jobs WHERE type = 'forums.mergeFinalize'",
      )
      .get()!;
    expect(job.status).toBe("pending");
    expect(job.last_error).toContain("streamStarts");
  });

  test("a split carries the source's active thread bans to the new thread", async () => {
    const { ctx, node, author, moderator } = setup();
    const banned = userActor(insertUser(ctx));
    const expired = userActor(insertUser(ctx));
    const source = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Source",
      body: "Body",
    });
    const reply = await execute(ctx, postsCreateOp, author, {
      threadId: source.thread.id,
      body: "Reply",
    });
    await execute(ctx, getOperation("threadBans.create"), moderator, {
      threadId: source.thread.id,
      userId: actorUserId(banned)!,
      reason: "Flood",
    });
    ctx.sqlite
      .prepare(
        "INSERT INTO thread_bans (thread_id, user_id, moderator_id, reason, created_at, expires_at) VALUES (?1, ?2, ?3, 'Old', ?4, ?4)",
      )
      .run(source.thread.id, actorUserId(expired)!, actorUserId(moderator)!, ctx.now() - 1);
    const split = await execute(ctx, threadsSplitOp, moderator, {
      threadId: source.thread.id,
      postIds: [reply.id],
      title: "Split",
      nodeId: node.id,
    });
    await expect(
      execute(ctx, postsCreateOp, banned, { threadId: split.thread.id, body: "Still banned" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await execute(ctx, postsCreateOp, expired, { threadId: split.thread.id, body: "Welcome back" });
    expect(
      ctx.sqlite
        .prepare<{ user_id: number }, [number]>(
          "SELECT user_id FROM thread_bans WHERE thread_id = ?1",
        )
        .all(split.thread.id),
    ).toEqual([{ user_id: actorUserId(banned)! }]);
  });

  test("unread state and read markers compare post ids, not positions", async () => {
    const { ctx, node, author } = setup();
    const reader = userActor(insertUser(ctx));
    const thread = await execute(ctx, threadsCreateOp, author, {
      nodeId: node.id,
      title: "Thread",
      body: "Body",
    });
    const reply = await execute(ctx, postsCreateOp, author, {
      threadId: thread.thread.id,
      body: "Reply",
    });
    const marker = ctx.sqlite.prepare(
      "INSERT INTO thread_reads (user_id, thread_id, last_read_post_id, last_read_position, read_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (user_id, thread_id) DO UPDATE SET last_read_post_id = excluded.last_read_post_id, last_read_position = excluded.last_read_position",
    );
    // The newest post id was read; the jump target lags behind it.
    marker.run(actorUserId(reader)!, thread.thread.id, reply.id, 0, ctx.now());
    expect(
      (await execute(ctx, threadsGetOp, reader, { threadId: thread.thread.id })).thread.isUnread,
    ).toBe(false);
    // An older post id is unread even when its jump target is ahead.
    marker.run(actorUserId(reader)!, thread.thread.id, thread.post.id, 5, ctx.now());
    expect(
      (await execute(ctx, threadsGetOp, reader, { threadId: thread.thread.id })).thread.isUnread,
    ).toBe(true);
    expect(
      (await execute(ctx, threadsMarkReadOp, reader, { threadId: thread.thread.id, position: 1 }))
        .readPosition,
    ).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ last_read_post_id: number }, [number, number]>(
          "SELECT last_read_post_id FROM thread_reads WHERE user_id = ?1 AND thread_id = ?2",
        )
        .get(actorUserId(reader)!, thread.thread.id)?.last_read_post_id,
    ).toBe(reply.id);
  });
});
