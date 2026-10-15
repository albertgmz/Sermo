import { describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { type Ctx, invalidate } from "../../context";
import { execute } from "../../operation";
import { runDueJobs } from "../jobs";
import { registerModerationJobs } from "../moderation";
import { postsListOp, threadsCreateOp, threadsMergeOp } from "./index";

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
}

const nextJob = (ctx: Ctx) =>
  ctx.sqlite
    .prepare<{ type: string; payload: string }, []>(
      "SELECT type, payload FROM jobs WHERE status = 'pending' ORDER BY id LIMIT 1",
    )
    .get();

/** Runs jobs one at a time until the next one is the merge's finalize job in `phase`. */
async function runUntilPhase(ctx: Ctx, phase: "streams" | "flip" | "reads") {
  for (let i = 0; i < 80; i++) {
    const job = nextJob(ctx);
    if (!job) break;
    if (
      job.type === "forums.mergeFinalize" &&
      (JSON.parse(job.payload).phase ?? "streams") === phase
    )
      return;
    await runDueJobs(ctx, { limit: 1 });
  }
  throw new Error(`The merge never reached ${phase}.`);
}

/**
 * What a poller that holds the thread's posts 0..100 gets: the id of the post at 100 now, and
 * every post above it, paged through the cursor.
 */
async function poll(ctx: Ctx, actor: ReturnType<typeof userActor>, threadId: number) {
  const items: { id: number; position: number }[] = [];
  let afterPostId: number | null | undefined;
  let cursor: string | undefined;
  for (let guard = 0; guard < 20; guard++) {
    const page = await execute(ctx, postsListOp, actor, {
      threadId,
      limit: 100,
      ...(cursor ? { cursor } : { afterPosition: 100 }),
    });
    if (!cursor) afterPostId = page.afterPostId;
    items.push(...page.items.map(({ id, position }) => ({ id, position })));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return { afterPostId, items };
}

async function setup(sourceStartsAfterTarget: boolean) {
  const ctx = createTestContext();
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const author = insertUser(ctx);
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const member = userActor(insertUser(ctx));
  registerModerationJobs(ctx);
  const target = await execute(ctx, threadsCreateOp, userActor(author), {
    nodeId: node.id,
    title: "Target",
    body: "Body",
  });
  const source = await execute(ctx, threadsCreateOp, userActor(author), {
    nodeId: node.id,
    title: "Source",
    body: "Body",
  });
  const start = ctx.now() + 1000;
  addPosts(ctx, target.thread.id, author.id, 100, start);
  // Either every source post is newer than every target post, or they interleave.
  addPosts(
    ctx,
    source.thread.id,
    author.id,
    600,
    sourceStartsAfterTarget ? start + 10_000 : start + 5,
  );
  // The opening post of the source is part of the merge too: it is newer as well.
  if (sourceStartsAfterTarget)
    ctx.sqlite
      .prepare("UPDATE posts SET created_at = ?2 WHERE thread_id = ?1 AND position = 0")
      .run(source.thread.id, start + 9_000);
  const held = ctx.sqlite
    .prepare<{ id: number }, [number]>(
      "SELECT id FROM posts WHERE thread_id = ?1 AND position = 100",
    )
    .get(target.thread.id)!.id;
  return { ctx, moderator, member, target: target.thread.id, source: source.thread.id, held };
}

const phasesOf = async (w: Awaited<ReturnType<typeof setup>>) => {
  const run = async () => ({
    member: (await poll(w.ctx, w.member, w.target)).afterPostId,
    moderator: (await poll(w.ctx, w.moderator, w.target)).afterPostId,
  });
  const seen = [await run()];
  await execute(w.ctx, threadsMergeOp, w.moderator, {
    threadId: w.target,
    sourceThreadIds: [w.source],
  });
  seen.push(await run());
  await runUntilPhase(w.ctx, "streams");
  await runDueJobs(w.ctx, { limit: 2 });
  seen.push(await run());
  await runUntilPhase(w.ctx, "flip");
  await runDueJobs(w.ctx, { limit: 1 });
  seen.push(await run());
  await runDueJobs(w.ctx);
  seen.push(await run());
  return seen;
};

const uniqueAndAscending = (items: { id: number; position: number }[]) => {
  expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  expect(items.every((item, i) => i === 0 || item.position > items[i - 1]!.position)).toBe(true);
  expect(items.every((item) => item.position >= 0)).toBe(true);
};

describe("posts.list afterPosition around a merge into the thread", () => {
  test("the post at the held position changes when older posts are merged in: a poller reloads", async () => {
    const w = await setup(false);
    const before = await poll(w.ctx, w.member, w.target);
    expect(before).toEqual({ afterPostId: w.held, items: [] });

    await execute(w.ctx, threadsMergeOp, w.moderator, {
      threadId: w.target,
      sourceThreadIds: [w.source],
    });
    const phases: Record<string, Awaited<ReturnType<typeof poll>>> = {};
    phases.requested = await poll(w.ctx, w.member, w.target);
    await runUntilPhase(w.ctx, "streams");
    await runDueJobs(w.ctx, { limit: 2 });
    phases.streaming = await poll(w.ctx, w.member, w.target);
    await runUntilPhase(w.ctx, "flip");
    await runDueJobs(w.ctx, { limit: 1 });
    phases.flipping = await poll(w.ctx, w.member, w.target);
    await runDueJobs(w.ctx);
    phases.done = await poll(w.ctx, w.member, w.target);

    for (const [name, answer] of Object.entries(phases)) {
      // The signal says reload in every phase, and a phase repeats no post.
      expect(answer.afterPostId, name).not.toBe(w.held);
      uniqueAndAscending(answer.items);
    }
    // And every phase gives one answer: chunks running between two polls change nothing.
    expect(phases.streaming).toEqual(phases.requested);
    expect(phases.flipping).toEqual(phases.requested);
    expect(phases.done).toEqual(phases.requested);
    // The reload (from the start) holds every post exactly once, in order.
    const all = await execute(w.ctx, postsListOp, w.member, { threadId: w.target, limit: 100 });
    expect(all.afterPostId).toBeUndefined();
    expect(all.items[0]!.position).toBe(0);
  });

  test("posts merged in above the held ones leave the signal alone: a poller appends", async () => {
    const w = await setup(true);
    expect(await poll(w.ctx, w.member, w.target)).toEqual({ afterPostId: w.held, items: [] });
    await execute(w.ctx, threadsMergeOp, w.moderator, {
      threadId: w.target,
      sourceThreadIds: [w.source],
    });
    const seen: Awaited<ReturnType<typeof poll>>[] = [await poll(w.ctx, w.member, w.target)];
    await runUntilPhase(w.ctx, "flip");
    await runDueJobs(w.ctx, { limit: 1 });
    seen.push(await poll(w.ctx, w.member, w.target));
    await runDueJobs(w.ctx);
    seen.push(await poll(w.ctx, w.member, w.target));
    for (const answer of seen) {
      expect(answer.afterPostId).toBe(w.held);
      uniqueAndAscending(answer.items);
      expect(answer.items[0]!.position).toBe(101);
      expect(answer.items).toHaveLength(601);
    }
    expect(seen[1]).toEqual(seen[0]!);
    expect(seen[2]).toEqual(seen[0]!);
  });

  test("a held post that is hidden from the viewer gives null in every phase of a merge, and its id to a moderator", async () => {
    const w = await setup(true);
    w.ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1").run(w.held);
    for (const seen of await phasesOf(w)) expect(seen).toEqual({ member: null, moderator: w.held });
  });

  test("posts that leave the thread (as a split moves them) change the signal; an ordinary reply does not", async () => {
    const w = await setup(true);
    await execute(w.ctx, threadsMergeOp, w.moderator, {
      threadId: w.target,
      sourceThreadIds: [w.source],
    });
    await runDueJobs(w.ctx);
    expect((await poll(w.ctx, w.member, w.target)).afterPostId).toBe(w.held);
    addPosts(w.ctx, w.target, 1, 1, w.ctx.now() + 50_000);
    expect((await poll(w.ctx, w.member, w.target)).afterPostId).toBe(w.held);
    // A held post in the middle that is split out is not seen by the poll: the posts that stay
    // keep their positions, so the post at the held position is the same.
    w.ctx.sqlite
      .prepare("UPDATE posts SET thread_id = ?2 WHERE thread_id = ?1 AND position = 60")
      .run(w.target, w.source);
    expect((await poll(w.ctx, w.member, w.target)).afterPostId).toBe(w.held);
    // Positions at and above 50 leave the thread: nothing sits at 100 any more.
    w.ctx.sqlite
      .prepare("UPDATE posts SET thread_id = ?2 WHERE thread_id = ?1 AND position >= 50")
      .run(w.target, w.source);
    expect((await poll(w.ctx, w.member, w.target)).afterPostId).toBeNull();
  });
});
