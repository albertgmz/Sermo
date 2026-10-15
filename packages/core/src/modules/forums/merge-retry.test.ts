import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { type Ctx, invalidate } from "../../context";
import { execute } from "../../operation";
import { runDueJobs } from "../jobs";
import { registerModerationJobs } from "../moderation";
import { searchQueryOp } from "../search";
import {
  postsGetOp,
  postsListOp,
  threadsCreateOp,
  threadsGetOp,
  threadsListOp,
  threadsMergeOp,
} from "./index";

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

for (const phase of ["streams", "flip", "reads"] as const) {
  test(`reads and the merge retry response expose real last post positions during ${phase}`, async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = insertUser(ctx);
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
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
    addPosts(ctx, source.thread.id, author.id, 600, start + 5);

    const input = { threadId: target.thread.id, sourceThreadIds: [source.thread.id] };
    await execute(ctx, threadsMergeOp, moderator, input);

    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      const job = nextJob(ctx)!;
      reached =
        job.type === "forums.mergeFinalize" &&
        (JSON.parse(job.payload).phase ?? "streams") === phase;
      if (!reached) await runDueJobs(ctx, { limit: 1 });
    }
    expect(reached).toBe(true);
    // Run one chunk of this phase so its positions are the temporary ones.
    await runDueJobs(ctx, { limit: 1 });
    const negatives = ctx.sqlite
      .prepare<{ n: number }, [number]>(
        "SELECT COUNT(*) AS n FROM posts WHERE thread_id = ?1 AND position < 0",
      )
      .get(target.thread.id)!.n;
    if (phase !== "reads") expect(negatives).toBeGreaterThan(0);

    // The thread's newest post is its real last position once finished: 0..701.
    const lastId = ctx.sqlite
      .prepare<{ last_post_id: number }, [number]>("SELECT last_post_id FROM threads WHERE id = ?1")
      .get(target.thread.id)!.last_post_id;
    const stored = ctx.sqlite
      .prepare<{ position: number }, [number]>("SELECT position FROM posts WHERE id = ?1")
      .get(lastId)!.position;
    // Interrupt the job, then retry the same merge request.
    const job = ctx.sqlite
      .prepare<{ id: number }, []>(
        "SELECT id FROM jobs WHERE status = 'pending' AND type LIKE 'forums.%' ORDER BY id LIMIT 1",
      )
      .get()!;
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'running', attempts = 5, locked_until = 0 WHERE id = ?1")
      .run(job.id);
    await runDueJobs(ctx, { limit: 1 });
    const retried = await execute(ctx, threadsMergeOp, moderator, input);
    const got = await execute(ctx, threadsGetOp, moderator, { threadId: target.thread.id });
    const listed = await execute(ctx, threadsListOp, moderator, { nodeId: node.id });
    const fromList = listed.items.find((t) => t.id === target.thread.id)!;
    for (const thread of [retried.thread, got.thread, fromList])
      expect(thread.lastPost.position).toBeGreaterThanOrEqual(0);
    if (stored < 0) expect(retried.thread.lastPost.position).toBe(-stored - 1);

    await runDueJobs(ctx);
    const final = await execute(ctx, threadsGetOp, moderator, { threadId: target.thread.id });
    expect(final.thread.lastPost.position).toBe(701);
  });
}

test("posts and search results never expose the temporary positions of a merge in progress", async () => {
  const ctx = createTestContext();
  const node = insertNode(ctx, {});
  invalidate(ctx, "node_tree");
  const author = insertUser(ctx);
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
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
  addPosts(ctx, source.thread.id, author.id, 600, start + 5);
  await execute(ctx, threadsMergeOp, moderator, {
    threadId: target.thread.id,
    sourceThreadIds: [source.thread.id],
  });

  let reached = false;
  for (let i = 0; i < 60 && !reached; i++) {
    const job = nextJob(ctx)!;
    reached =
      job.type === "forums.mergeFinalize" &&
      (JSON.parse(job.payload).phase ?? "streams") === "flip";
    if (!reached) await runDueJobs(ctx, { limit: 1 });
  }
  expect(reached).toBe(true);
  await runDueJobs(ctx, { limit: 1 });

  const stored = ctx.sqlite
    .prepare<{ id: number; position: number }, [number]>(
      "SELECT id, position FROM posts WHERE thread_id = ?1",
    )
    .all(target.thread.id);
  const renumbered = stored.filter((post) => post.position < 0);
  expect(renumbered.length).toBeGreaterThan(0);
  const expected = new Map(
    stored.map((post) => [post.id, post.position < 0 ? -post.position - 1 : post.position]),
  );
  const probe = renumbered[0]!.id;
  ctx.sqlite.prepare("UPDATE post_bodies SET body_source = 'needle' WHERE post_id = ?1").run(probe);

  const got = await Promise.all(
    renumbered.map((post) => execute(ctx, postsGetOp, moderator, { postId: post.id })),
  );
  const listed = [];
  for (let page = 1; page <= 8; page++)
    listed.push(
      ...(
        await execute(ctx, postsListOp, moderator, { threadId: target.thread.id, page, limit: 100 })
      ).items,
    );
  const found = (await execute(ctx, searchQueryOp, moderator, { q: "needle" })).items;
  expect(listed.length).toBeGreaterThan(0);
  expect(found.length).toBe(1);
  const seen = [...got, ...listed].map((post) => [post.id, post.position] as const);
  seen.push([found[0]!.post.id, found[0]!.post.position]);
  for (const [id, position] of seen) {
    expect(position).toBeGreaterThanOrEqual(0);
    expect(position).toBe(expected.get(id)!);
  }

  await runDueJobs(ctx);
  const finalPositions = ctx.sqlite
    .prepare<{ id: number; position: number }, [number]>(
      "SELECT id, position FROM posts WHERE thread_id = ?1",
    )
    .all(target.thread.id);
  for (const [id, position] of seen)
    expect(finalPositions.find((p) => p.id === id)!.position).toBe(position);
});

// The target's posts are newer than the source's in one case and older in the other, so the
// renumbering moves posts between the two streams in opposite directions.
for (const [layout, targetStart, sourceStart] of [
  ["interleaved", 0, 5],
  ["target newer", 2000, 0],
  ["target older", 0, 2000],
] as const)
  test(`posts.list gives every post one stable place while a merge runs between page requests (${layout})`, async () => {
    const ctx = createTestContext();
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const author = insertUser(ctx);
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
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
    addPosts(ctx, target.thread.id, author.id, 100, start + targetStart);
    addPosts(ctx, source.thread.id, author.id, 600, start + sourceStart);
    const everyPost = ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "SELECT id FROM posts WHERE thread_id IN (?1, ?2) ORDER BY id",
      )
      .all(target.thread.id, source.thread.id)
      .map((post) => post.id);
    await execute(ctx, threadsMergeOp, moderator, {
      threadId: target.thread.id,
      sourceThreadIds: [source.thread.id],
    });

    // One full traversal, with a job step between every two page requests.
    const traverse = async () => {
      const seen: { id: number; position: number }[] = [];
      let cursor: string | undefined;
      do {
        const page = await execute(ctx, postsListOp, moderator, {
          threadId: target.thread.id,
          limit: 37,
          cursor,
        });
        seen.push(...page.items.map((post) => ({ id: post.id, position: post.position })));
        cursor = page.nextCursor ?? undefined;
        const job = nextJob(ctx);
        if (job?.type === "forums.mergeFinalize")
          phases.add((JSON.parse(job.payload).phase ?? "streams") as string);
        if (cursor) await runDueJobs(ctx, { limit: 1 });
      } while (cursor);
      return seen;
    };
    const traversals = [];
    const phases = new Set<string>();
    for (let i = 0; i < 40 && nextJob(ctx); i++) traversals.push(await traverse());
    expect(nextJob(ctx)).toBeNull();
    expect([...phases]).toEqual(expect.arrayContaining(["streams", "flip", "reads"]));
    traversals.push(await traverse());

    const final = new Map(
      ctx.sqlite
        .prepare<{ id: number; position: number }, [number]>(
          "SELECT id, position FROM posts WHERE thread_id = ?1",
        )
        .all(target.thread.id)
        .map((post) => [post.id, post.position]),
    );
    expect(final.size).toBe(everyPost.length);
    for (const seen of traversals) {
      expect(seen.map((post) => post.id).sort((a, b) => a - b)).toEqual(everyPost);
      for (const [index, post] of seen.entries()) {
        expect(post.position).toBe(final.get(post.id)!);
        if (index > 0) expect(post.position).toBeGreaterThan(seen[index - 1]!.position);
      }
    }
  });
