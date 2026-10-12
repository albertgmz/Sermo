import { describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { actorUserId } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import { execute } from "../../operation";
import { threadsCreateOp, threadsMergeOp } from "../forums";
import { registerModerationJobs } from "../moderation";
import { enqueueJob, runDueJobs } from "./index";
import {
  REBUILD_CHUNK_SIZES,
  type RebuildProgress,
  rebuildCountersChunk,
  registerJobHandlers,
} from "./rebuild";

const STAGES = Object.keys(REBUILD_CHUNK_SIZES) as RebuildProgress["stage"][];

/** Runs every rebuild chunk of every stage once, as the daily chain would. */
function rebuildEverything(ctx: Ctx): void {
  for (const stage of STAGES) {
    const ids = ctx.sqlite
      .prepare<{ id: number }, []>(`SELECT id FROM ${stage} ORDER BY id`)
      .all()
      .map((row) => row.id);
    const size = REBUILD_CHUNK_SIZES[stage];
    for (let i = 0; i < ids.length; i += size)
      rebuildCountersChunk(
        ctx,
        { stage, after: i === 0 ? 0 : ids[i - 1]! },
        { enqueueNext: false },
      );
  }
}

function addPosts(ctx: Ctx, threadId: number, userId: number, count: number, start: number) {
  const insert = ctx.sqlite.prepare(
    "INSERT INTO posts (thread_id, user_id, position, state, created_at) VALUES (?1, ?2, ?3, 'visible', ?4)",
  );
  const body = ctx.sqlite.prepare(
    "INSERT INTO post_bodies (post_id, body_source, body_html) VALUES (?1, 'x', '<p>x</p>')",
  );
  const first =
    ctx.sqlite
      .prepare<{ position: number }, [number]>(
        "SELECT max(position) AS position FROM posts WHERE thread_id = ?1",
      )
      .get(threadId)!.position + 1;
  let last = 0;
  for (let i = 0; i < count; i++) {
    last = Number(insert.run(threadId, userId, first + i, start + i).lastInsertRowid);
    body.run(last);
  }
  ctx.sqlite
    .prepare(
      "UPDATE threads SET reply_count = reply_count + ?2, last_post_id = ?3, last_post_at = ?4 WHERE id = ?1",
    )
    .run(threadId, count, last, start + count);
  ctx.sqlite
    .prepare(
      "UPDATE nodes SET post_count = post_count + ?2 WHERE id = (SELECT node_id FROM threads WHERE id = ?1)",
    )
    .run(threadId, count);
  ctx.sqlite
    .prepare("UPDATE users SET post_count = post_count + ?2 WHERE id = ?1")
    .run(userId, count);
}

describe("counter rebuild during a thread merge", () => {
  test("rebuild chunks interleaved with merge chunks leave first posts and counters correct", async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const authorUser = insertUser(ctx);
    const author = userActor(authorUser);
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    registerModerationJobs(ctx);
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
    addPosts(ctx, target.thread.id, authorId, 100, start);
    addPosts(ctx, source.thread.id, authorId, 500, start + 5);
    rebuildEverything(ctx);

    await execute(ctx, threadsMergeOp, moderator, {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
    });
    const pending = ctx.sqlite.prepare<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM jobs WHERE status = 'pending' AND type LIKE 'forums.%'",
    );
    const firstPost = ctx.sqlite.prepare<{ first_post_id: number }, [number]>(
      "SELECT first_post_id FROM threads WHERE id = ?1",
    );
    let chunks = 0;
    while (pending.get()!.n > 0 && chunks++ < 100) {
      rebuildEverything(ctx);
      expect(firstPost.get(target.thread.id)!.first_post_id).toBe(target.post.id);
      await runDueJobs(ctx, { limit: 1 });
    }
    expect(chunks).toBeGreaterThan(1);
    expect(ctx.sqlite.prepare("SELECT 1 FROM thread_transfers").get()).toBeNull();
    rebuildEverything(ctx);

    expect(firstPost.get(target.thread.id)!.first_post_id).toBe(target.post.id);
    expect(
      ctx.sqlite
        .prepare<{ post_count: number }, [number]>("SELECT post_count FROM users WHERE id = ?1")
        .get(authorId)!.post_count,
    ).toBe(602);
    const counters = ctx.sqlite
      .prepare<{ reply_count: number }, [number]>("SELECT reply_count FROM threads WHERE id = ?1")
      .get(target.thread.id)!;
    expect(counters.reply_count).toBe(601);
  });
});

describe("counter rebuild continuation", () => {
  test("a chunk completes its own job with its successor and a replay queues nothing", () => {
    const ctx = createTestContext();
    insertNode(ctx, {});
    const id = enqueueJob(
      ctx,
      "rebuild-counters",
      { stage: "threads", after: 0 },
      {
        uniqueKey: "rebuild-counters",
      },
    )!;
    const lockedUntil = ctx.now() + 300_000;
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'running', locked_until = ?1 WHERE id = ?2")
      .run(lockedUntil, id);
    const claimed = { id, lockedUntil };
    const progress = { stage: "threads", after: 0 } as const;

    rebuildCountersChunk(ctx, progress, {}, claimed);
    const status = () =>
      ctx.sqlite
        .prepare<{ id: number; status: string; payload: string }, []>(
          "SELECT id, status, payload FROM jobs ORDER BY id",
        )
        .all();
    expect(status().map((job) => job.status)).toEqual(["done", "pending"]);
    expect(JSON.parse(status()[1]!.payload)).toEqual({ stage: "nodes", after: 0 });

    // The same claim replayed after the commit does nothing.
    expect(rebuildCountersChunk(ctx, progress, {}, claimed)).toBe(0);
    expect(status()).toHaveLength(2);
  });

  test("a full chain leaves one job row per chunk", async () => {
    const ctx = createTestContext();
    insertNode(ctx, {});
    registerJobHandlers(ctx);
    enqueueJob(
      ctx,
      "rebuild-counters",
      { stage: "threads", after: 0 },
      {
        uniqueKey: "rebuild-counters",
      },
    );
    await runDueJobs(ctx);
    const rows = ctx.sqlite
      .prepare<{ status: string; payload: string }, []>(
        "SELECT status, payload FROM jobs WHERE type = 'rebuild-counters'",
      )
      .all();
    expect(new Set(rows.map((row) => row.payload)).size).toBe(rows.length);
    expect(rows.length).toBeGreaterThanOrEqual(STAGES.length);
    expect(rows.every((row) => row.status === "done")).toBe(true);
  });
});
