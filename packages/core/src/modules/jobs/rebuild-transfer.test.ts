import { describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { actorUserId } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import { execute } from "../../operation";
import { threadsCreateOp, threadsDeleteOp, threadsMergeOp, threadsSplitOp } from "../forums";
import { registerModerationJobs } from "../moderation";
import { reactionsSetOp } from "../reactions";
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
  test("one user rebuild mid-merge preserves author counts through completion without another rebuild", async () => {
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
    await runDueJobs(ctx, { limit: 1 });
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>("SELECT COUNT(*) AS n FROM posts WHERE thread_id = ?1")
        .get(source.thread.id)!.n,
    ).toBe(1);
    rebuildCountersChunk(ctx, { stage: "users", after: 0 }, { enqueueNext: false });
    let chunks = 0;
    while (pending.get()!.n > 0 && chunks++ < 100) {
      const before = ctx.sqlite
        .prepare("SELECT id, first_post_id, reply_count FROM threads ORDER BY id")
        .all();
      rebuildCountersChunk(ctx, { stage: "threads", after: 0 }, { enqueueNext: false });
      rebuildCountersChunk(ctx, { stage: "nodes", after: 0 }, { enqueueNext: false });
      expect(
        ctx.sqlite.prepare("SELECT id, first_post_id, reply_count FROM threads ORDER BY id").all(),
      ).toEqual(before);
      expect(firstPost.get(target.thread.id)!.first_post_id).toBe(target.post.id);
      await runDueJobs(ctx, { limit: 1 });
    }
    expect(chunks).toBeGreaterThan(1);
    expect(ctx.sqlite.prepare("SELECT 1 FROM thread_transfers").get()).toBeNull();
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

type TransferKind = "merge" | "split";

async function startTransfer(kind: TransferKind, hiddenSource = false, hiddenTarget = false) {
  const ctx = createTestContext();
  const sourceNode = insertNode(ctx, {});
  const targetNode = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const author = insertUser(ctx);
  const reactor = userActor(insertUser(ctx));
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  registerModerationJobs(ctx);
  const source = await execute(ctx, threadsCreateOp, userActor(author), {
    nodeId: sourceNode.id,
    title: "Source",
    body: "Body",
  });
  addPosts(ctx, source.thread.id, author.id, 600, ctx.now() + 1000);
  await execute(ctx, reactionsSetOp, reactor, {
    contentType: "post",
    contentId: source.post.id,
    reactionTypeId: 1,
  });
  if (hiddenSource) await execute(ctx, threadsDeleteOp, moderator, { threadId: source.thread.id });
  const target =
    kind === "merge"
      ? await execute(ctx, threadsCreateOp, userActor(author), {
          nodeId: targetNode.id,
          title: "Target",
          body: "Body",
        })
      : null;
  if (target) {
    addPosts(ctx, target.thread.id, author.id, 100, ctx.now() + 1005);
    if (hiddenTarget)
      await execute(ctx, threadsDeleteOp, moderator, { threadId: target.thread.id });
  }
  rebuildEverything(ctx);
  const mergeInput = { threadId: target?.thread.id ?? 0, sourceThreadIds: [source.thread.id] };
  const splitInput = {
    threadId: source.thread.id,
    nodeId: targetNode.id,
    title: "Split",
    fromPosition: 1,
  };
  const started = target
    ? await execute(ctx, threadsMergeOp, moderator, mergeInput)
    : await execute(ctx, threadsSplitOp, moderator, splitInput);
  expect(started.completed).toBe(false);
  return {
    ctx,
    author,
    source,
    targetId: started.thread.id,
    sourceNode,
    targetNode,
    retry: () =>
      target
        ? execute(ctx, threadsMergeOp, moderator, mergeInput)
        : execute(ctx, threadsSplitOp, moderator, splitInput),
  };
}

function userCounts(ctx: Ctx, id: number) {
  return ctx.sqlite
    .prepare<{ post_count: number; reaction_score: number }, [number]>(
      "SELECT post_count, reaction_score FROM users WHERE id = ?1",
    )
    .get(id)!;
}

function physicalPostCount(ctx: Ctx, userId: number) {
  return ctx.sqlite
    .prepare<{ n: number }, [number]>(
      "SELECT COUNT(*) AS n FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.user_id = ?1 AND p.state = 'visible' AND t.state = 'visible'",
    )
    .get(userId)!.n;
}

async function failNextTransfer(ctx: Ctx) {
  const job = ctx.sqlite
    .prepare<{ id: number }, []>(
      "SELECT id FROM jobs WHERE status = 'pending' AND type LIKE 'forums.%' ORDER BY id LIMIT 1",
    )
    .get()!;
  ctx.sqlite
    .prepare("UPDATE jobs SET status = 'running', attempts = 5, locked_until = 0 WHERE id = ?1")
    .run(job.id);
  await runDueJobs(ctx, { limit: 1 });
  expect(
    ctx.sqlite
      .prepare<{ status: string }, [number]>("SELECT status FROM jobs WHERE id = ?1")
      .get(job.id)!.status,
  ).toBe("failed");
  expect(
    ctx.sqlite.prepare("SELECT 1 FROM thread_transfers WHERE failed_at IS NULL").get(),
  ).toBeNull();
}

describe("counter rebuild with transfer guards", () => {
  for (const kind of ["merge", "split"] as const) {
    test(`repairs node counts during a pending ${kind} without disturbing later transfer deltas`, async () => {
      const { ctx } = await startTransfer(kind);
      await runDueJobs(ctx, { limit: 1 });
      const physicalCounts = () =>
        ctx.sqlite
          .prepare(
            "SELECT n.id, COUNT(DISTINCT t.id) AS thread_count, COUNT(p.id) AS post_count FROM nodes n LEFT JOIN threads t ON t.node_id = n.id AND t.state = 'visible' LEFT JOIN posts p ON p.thread_id = t.id AND p.state = 'visible' GROUP BY n.id ORDER BY n.id",
          )
          .all();
      const storedCounts = () =>
        ctx.sqlite.prepare("SELECT id, thread_count, post_count FROM nodes ORDER BY id").all();
      expect(storedCounts()).toEqual(physicalCounts());
      ctx.sqlite.exec("UPDATE nodes SET thread_count = 9999, post_count = 9999");
      // Nodes use the thread counters, which the transfer maintains atomically in each chunk.
      rebuildCountersChunk(ctx, { stage: "nodes", after: 0 }, { enqueueNext: false });
      rebuildCountersChunk(ctx, { stage: "nodes", after: 1 }, { enqueueNext: false });
      expect(storedCounts()).toEqual(physicalCounts());
      await runDueJobs(ctx);
      expect(ctx.sqlite.prepare("SELECT 1 FROM thread_transfers").get()).toBeNull();
      expect(storedCounts()).toEqual(physicalCounts());
    });

    test(`repairs reaction scores during a pending ${kind} without changing transfer counters`, async () => {
      const { ctx, author } = await startTransfer(kind);
      const posts = userCounts(ctx, author.id).post_count;
      ctx.sqlite.prepare("UPDATE users SET reaction_score = 99 WHERE id = ?1").run(author.id);
      rebuildCountersChunk(ctx, { stage: "users", after: 0 }, { enqueueNext: false });
      expect(userCounts(ctx, author.id)).toEqual({ post_count: posts, reaction_score: 1 });
      await runDueJobs(ctx);
      expect(userCounts(ctx, author.id).post_count).toBe(physicalPostCount(ctx, author.id));
    });

    for (const partial of [false, true]) {
      for (const hidden of [false, true]) {
        test(`repairs a failed ${hidden ? "hidden" : "visible"} ${kind} ${partial ? "after" : "before"} a queued post chunk and permits retry`, async () => {
          const { ctx, author, source, targetId, retry } = await startTransfer(kind, hidden);
          if (partial) await runDueJobs(ctx, { limit: 1 });
          const logicalPosts = userCounts(ctx, author.id).post_count;
          await failNextTransfer(ctx);
          ctx.sqlite
            .prepare("UPDATE users SET post_count = 9999, reaction_score = 99 WHERE id = ?1")
            .run(author.id);
          ctx.sqlite.exec(
            "UPDATE threads SET reply_count = 9999; UPDATE nodes SET thread_count = 9999, post_count = 9999",
          );
          rebuildEverything(ctx);
          expect(userCounts(ctx, author.id)).toEqual({
            post_count: logicalPosts,
            reaction_score: 1,
          });
          for (const id of [source.thread.id, targetId]) {
            const n = ctx.sqlite
              .prepare<{ n: number }, [number]>(
                "SELECT COUNT(*) AS n FROM posts WHERE thread_id = ?1 AND state = 'visible'",
              )
              .get(id)!.n;
            expect(
              ctx.sqlite
                .prepare<{ reply_count: number }, [number]>(
                  "SELECT reply_count FROM threads WHERE id = ?1",
                )
                .get(id)!.reply_count,
            ).toBe(Math.max(0, n - 1));
          }
          for (const node of ctx.sqlite
            .prepare<{ id: number; post_count: number; thread_count: number }, []>(
              "SELECT id, post_count, thread_count FROM nodes",
            )
            .all()) {
            const counts = ctx.sqlite
              .prepare<{ post_count: number; thread_count: number }, [number]>(
                "SELECT COUNT(p.id) AS post_count, COUNT(DISTINCT t.id) AS thread_count FROM threads t LEFT JOIN posts p ON p.thread_id = t.id AND p.state = 'visible' WHERE t.node_id = ?1 AND t.state = 'visible'",
              )
              .get(node.id)!;
            expect(node).toEqual({ id: node.id, ...counts });
          }
          await retry();
          await runDueJobs(ctx);
          expect(ctx.sqlite.prepare("SELECT 1 FROM thread_transfers").get()).toBeNull();
          expect(userCounts(ctx, author.id).post_count).toBe(physicalPostCount(ctx, author.id));
        });
      }
    }
  }

  for (const hiddenSource of [false, true]) {
    for (const partial of [false, true]) {
      test(`failed merge into a hidden target preserves retry deltas from a ${hiddenSource ? "hidden" : "visible"} source, ${partial ? "partly moved" : "unmoved"}`, async () => {
        const { ctx, author, retry } = await startTransfer("merge", hiddenSource, true);
        if (partial) await runDueJobs(ctx, { limit: 1 });
        const expectedPosts = hiddenSource ? 0 : partial ? 101 : 601;
        expect(userCounts(ctx, author.id).post_count).toBe(expectedPosts);
        await failNextTransfer(ctx);
        for (let pass = 0; pass < 3; pass++) {
          ctx.sqlite
            .prepare("UPDATE users SET post_count = 9999, reaction_score = 99 WHERE id = ?1")
            .run(author.id);
          ctx.sqlite.exec("UPDATE nodes SET post_count = 9999, thread_count = 9999");
          rebuildEverything(ctx);
          expect(userCounts(ctx, author.id)).toEqual({
            post_count: expectedPosts,
            reaction_score: 1,
          });
          expect(ctx.sqlite.prepare("SELECT post_count, thread_count FROM nodes").all()).toEqual([
            { post_count: 0, thread_count: 0 },
            { post_count: 0, thread_count: 0 },
          ]);
        }
        await retry();
        await runDueJobs(ctx);
        expect(ctx.sqlite.prepare("SELECT 1 FROM thread_transfers").get()).toBeNull();
        expect(userCounts(ctx, author.id)).toEqual({ post_count: 0, reaction_score: 1 });
      });
    }
  }

  for (const phase of ["streams", "flip", "reads"] as const) {
    test(`rebuilds a failed merge during ${phase} without mistaking temporary positions for first and last posts`, async () => {
      const { ctx, author, targetId } = await startTransfer("merge");
      const firstId = ctx.sqlite
        .prepare<{ id: number }, [number]>(
          "SELECT id FROM posts WHERE thread_id = ?1 AND position = 0",
        )
        .get(targetId)!.id;
      let reached = false;
      for (let i = 0; i < 40; i++) {
        const job = ctx.sqlite
          .prepare<{ type: string; payload: string }, []>(
            "SELECT type, payload FROM jobs WHERE status = 'pending' ORDER BY id LIMIT 1",
          )
          .get()!;
        if (
          job.type === "forums.mergeFinalize" &&
          (JSON.parse(job.payload).phase ?? "streams") === phase
        ) {
          await runDueJobs(ctx, { limit: 1 });
          reached = true;
          break;
        }
        await runDueJobs(ctx, { limit: 1 });
      }
      expect(reached).toBe(true);
      await failNextTransfer(ctx);
      const lastId = ctx.sqlite
        .prepare<{ id: number }, [number, number]>(
          "SELECT id FROM posts WHERE thread_id = ?1 AND id != ?2 ORDER BY created_at DESC, id DESC LIMIT 1",
        )
        .get(targetId, firstId)!.id;
      ctx.sqlite
        .prepare(
          "UPDATE threads SET first_post_id = NULL, last_post_id = NULL, reply_count = 9999 WHERE id = ?1",
        )
        .run(targetId);
      ctx.sqlite.prepare("UPDATE users SET post_count = 9999 WHERE id = ?1").run(author.id);
      rebuildEverything(ctx);
      expect(
        ctx.sqlite
          .prepare("SELECT first_post_id, last_post_id, reply_count FROM threads WHERE id = ?1")
          .get(targetId),
      ).toEqual({ first_post_id: firstId, last_post_id: lastId, reply_count: 701 });
      expect(userCounts(ctx, author.id).post_count).toBe(702);
      // Resume the durable job directly: the forum retry response exposes temporary negative
      // positions during the flip phase. This test covers rebuilding and resuming the job.
      ctx.sqlite.exec(
        "UPDATE jobs SET status = 'pending', attempts = 0, run_at = 0 WHERE status = 'failed'; UPDATE thread_transfers SET failed_at = NULL",
      );
      await runDueJobs(ctx);
      expect(
        ctx.sqlite
          .prepare("SELECT first_post_id, last_post_id, reply_count FROM threads WHERE id = ?1")
          .get(targetId),
      ).toEqual({ first_post_id: firstId, last_post_id: lastId, reply_count: 701 });
      expect(userCounts(ctx, author.id).post_count).toBe(702);
    });
  }
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
