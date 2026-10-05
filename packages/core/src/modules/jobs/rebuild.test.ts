import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { invalidate } from "../../context";
import { execute } from "../../operation";
import {
  conversationsCreateOp,
  conversationsLeaveOp,
  conversationsReplyOp,
} from "../conversations";
import {
  postsCreateOp,
  postsDeleteOp,
  threadsCreateOp,
  threadsDeleteOp,
  threadsMoveOp,
  threadsSetStickyOp,
} from "../forums";
import {
  profileCommentsCreateOp,
  profileCommentsDeleteOp,
  profilePostsCreateOp,
} from "../profiles";
import { reactionsSetOp } from "../reactions";
import { enqueueJob, rebuildCountersChunk, runDueJobs, startScheduler } from "./index";
import { registerJobHandlers } from "./rebuild";
import { purgeSql, runDailyTasks, runHourlyTasks, runViewsTask } from "./scheduler";

describe("job maintenance", () => {
  test("hourly and daily tasks purge stale rows and enqueue one rebuild", async () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    const actor = userActor(user);
    const forum = insertNode(ctx, {});
    const made = await execute(ctx, threadsCreateOp, actor, {
      nodeId: forum.id,
      title: "Old",
      body: "body",
    });
    expect(made.post.id).toBeGreaterThan(0);
    ctx.sqlite
      .prepare(
        "INSERT INTO auth_verification (identifier, value, expires_at, created_at, updated_at) VALUES ('x', 'x', ?1, ?1, ?1)",
      )
      .run(ctx.now());
    const done = enqueueJob(ctx, "irrelevant", {})!;
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'done', updated_at = ?1 WHERE id = ?2")
      .run(ctx.now(), done);
    ctx.clock.advance(31 * 24 * 60 * 60_000);
    runHourlyTasks(ctx);
    expect(
      ctx.sqlite.prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM thread_reads").get()?.n,
    ).toBe(0);
    expect(
      ctx.sqlite.prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM auth_verification").get()?.n,
    ).toBe(0);
    expect(
      ctx.sqlite.prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM jobs WHERE id = 1").get()?.n,
    ).toBe(0);
    runDailyTasks(ctx);
    runDailyTasks(ctx);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM jobs WHERE unique_key = 'rebuild-counters'",
        )
        .get()?.n,
    ).toBe(1);
    const stop = startScheduler(ctx);
    stop();
  });

  test("purges use indexed batches and retain recent reads, recent done jobs, and failed jobs", async () => {
    const ctx = createTestContext();
    const author = insertUser(ctx);
    const forum = insertNode(ctx, {});
    const old = await execute(ctx, threadsCreateOp, userActor(author), {
      nodeId: forum.id,
      title: "Old",
      body: "old",
    });
    ctx.sqlite.prepare("DELETE FROM thread_reads").run();
    const insertRead = ctx.sqlite.prepare(
      "INSERT INTO thread_reads (user_id, thread_id, last_read_post_id, last_read_position, read_at) VALUES (?1, ?2, ?3, 0, ?4)",
    );
    const sizes: number[] = [];
    const deleteReads = ctx.sqlite.prepare(
      "DELETE FROM thread_reads WHERE id IN (SELECT value FROM json_each(?1))",
    );
    ctx.statements.set("jobs.deleteReads", {
      run(json: string) {
        sizes.push((JSON.parse(json) as number[]).length);
        return deleteReads.run(json);
      },
    });
    for (let i = 0; i < 1002; i++) {
      const user = insertUser(ctx);
      insertRead.run(user.id, old.thread.id, old.post.id, ctx.now());
    }
    ctx.clock.advance(31 * 24 * 60 * 60_000);
    const recent = await execute(ctx, threadsCreateOp, userActor(author), {
      nodeId: forum.id,
      title: "New",
      body: "new",
    });
    const recentDone = enqueueJob(ctx, "x", {})!;
    const failed = enqueueJob(ctx, "x", {})!;
    const oldDone = enqueueJob(ctx, "x", {})!;
    ctx.sqlite.prepare("UPDATE jobs SET status = 'done' WHERE id = ?1").run(recentDone);
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'failed', run_at = ?1 WHERE id = ?2")
      .run(ctx.now() - 8 * 24 * 60 * 60_000, failed);
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'done', run_at = ?1 WHERE id = ?2")
      .run(ctx.now() - 8 * 24 * 60 * 60_000, oldDone);
    expectNoTableScan(ctx, purgeSql.reads, [0]);
    expectNoTableScan(ctx, purgeSql.done, [ctx.now() - 7 * 24 * 60 * 60_000]);
    runHourlyTasks(ctx);
    expect(sizes).toEqual([1000, 2]);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT COUNT(*) AS n FROM thread_reads WHERE thread_id = ?1",
        )
        .get(old.thread.id)?.n,
    ).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT COUNT(*) AS n FROM thread_reads WHERE thread_id = ?1",
        )
        .get(recent.thread.id)?.n,
    ).toBe(1);
    const remaining = ctx.sqlite
      .prepare<{ id: number }, []>("SELECT id FROM jobs")
      .all()
      .map((row) => row.id);
    expect(remaining).toContain(recentDone);
    expect(remaining).toContain(failed);
    expect(remaining).not.toContain(oldDone);
    ctx.views.set(recent.thread.id, 4);
    expect(runViewsTask(ctx)).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ view_count: number }, [number]>("SELECT view_count FROM threads WHERE id = ?1")
        .get(recent.thread.id)?.view_count,
    ).toBe(4);
  });

  test("daily task enqueues the rebuild and invokes PRAGMA optimize", () => {
    const ctx = createTestContext();
    const original = ctx.sqlite.exec.bind(ctx.sqlite);
    let optimized = 0;
    ctx.sqlite.exec = (sql: string) => {
      if (sql === "PRAGMA optimize") optimized++;
      return original(sql);
    };
    runDailyTasks(ctx);
    expect(optimized).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ payload: string }, []>(
          "SELECT payload FROM jobs WHERE unique_key = 'rebuild-counters'",
        )
        .get()?.payload,
    ).toBe('{"stage":"threads","after":0}');
  });

  test("rebuild restores all counter families from real operations and skips correct rows", async () => {
    const ctx = createTestContext();
    const author = insertUser(ctx);
    const reactor = insertUser(ctx);
    const left = insertUser(ctx);
    const untouched = insertUser(ctx);
    const a = userActor(author);
    const b = userActor(reactor);
    const forum = insertNode(ctx, {});
    const thread = await execute(ctx, threadsCreateOp, a, {
      nodeId: forum.id,
      title: "Thread",
      body: "start",
    });
    const reply = await execute(ctx, postsCreateOp, a, {
      threadId: thread.thread.id,
      body: "reply",
    });
    const profile = await execute(ctx, profilePostsCreateOp, a, {
      userId: author.id,
      body: "wall",
    });
    const comment = await execute(ctx, profileCommentsCreateOp, b, {
      profilePostId: profile.id,
      body: "comment",
    });
    const conv = await execute(ctx, conversationsCreateOp, a, {
      title: "Private",
      recipientIds: [reactor.id, left.id],
      body: "first",
    });
    await execute(ctx, conversationsLeaveOp, userActor(left), {
      conversationId: conv.conversation.id,
    });
    const leftAt = ctx.sqlite
      .prepare<{ last_message_at: number }, [number, number]>(
        "SELECT last_message_at FROM conversation_participants WHERE conversation_id = ?1 AND user_id = ?2",
      )
      .get(conv.conversation.id, left.id)!.last_message_at;
    ctx.clock.advance(1);
    const message = await execute(ctx, conversationsReplyOp, a, {
      conversationId: conv.conversation.id,
      body: "second",
    });
    await execute(ctx, reactionsSetOp, b, {
      contentType: "post",
      contentId: reply.id,
      reactionTypeId: 1,
    });
    await execute(ctx, reactionsSetOp, b, {
      contentType: "profile_post",
      contentId: profile.id,
      reactionTypeId: 1,
    });
    await execute(ctx, reactionsSetOp, a, {
      contentType: "profile_post_comment",
      contentId: comment.id,
      reactionTypeId: 1,
    });
    await execute(ctx, reactionsSetOp, b, {
      contentType: "conversation_message",
      contentId: message.id,
      reactionTypeId: 1,
    });
    ctx.sqlite
      .prepare(
        "UPDATE threads SET reply_count = 99, first_post_id = NULL, last_post_id = NULL, last_post_at = 0, last_poster_id = ?2 WHERE id = ?1",
      )
      .run(thread.thread.id, reactor.id);
    ctx.sqlite
      .prepare(
        "UPDATE nodes SET thread_count = 99, post_count = 99, last_post_at = 0, last_post_id = NULL, last_thread_id = NULL, last_thread_title = 'wrong', last_poster_id = NULL WHERE id = ?1",
      )
      .run(forum.id);
    ctx.sqlite
      .prepare("UPDATE users SET post_count = 99, reaction_score = 99 WHERE id IN (?1, ?2)")
      .run(author.id, reactor.id);
    ctx.sqlite
      .prepare(
        "UPDATE profile_posts SET comment_count = 99, last_comment_at = NULL, reaction_counts = '{\"99\":9}' WHERE id = ?1",
      )
      .run(profile.id);
    ctx.sqlite
      .prepare(
        "UPDATE conversations SET message_count = 99, participant_count = 99, last_message_id = NULL, last_message_at = 0, last_message_user_id = ?2 WHERE id = ?1",
      )
      .run(conv.conversation.id, reactor.id);
    ctx.sqlite
      .prepare(
        "UPDATE conversation_participants SET last_message_at = 0 WHERE conversation_id = ?1 AND state = 'active'",
      )
      .run(conv.conversation.id);
    for (const [table, id] of [
      ["posts", reply.id],
      ["profile_post_comments", comment.id],
      ["conversation_messages", message.id],
    ] as const)
      ctx.sqlite.prepare(`UPDATE ${table} SET reaction_counts = '{"99":9}' WHERE id = ?1`).run(id);
    ctx.sqlite.exec(
      `CREATE TRIGGER untouched_user BEFORE UPDATE OF post_count, reaction_score ON users WHEN new.id = ${untouched.id} BEGIN SELECT RAISE(ABORT, 'correct row updated'); END`,
    );
    registerJobHandlers(ctx);
    enqueueJob(
      ctx,
      "rebuild-counters",
      { stage: "threads", after: 0 },
      { uniqueKey: "rebuild-counters" },
    );
    expect(await runDueJobs(ctx, { limit: 100 })).toBeGreaterThanOrEqual(8);
    const scalar = (sql: string, id: number) =>
      ctx.sqlite.prepare<{ n: number }, [number]>(sql).get(id)!.n;
    expect(scalar("SELECT reply_count AS n FROM threads WHERE id = ?1", thread.thread.id)).toBe(1);
    expect(scalar("SELECT first_post_id AS n FROM threads WHERE id = ?1", thread.thread.id)).toBe(
      thread.post.id,
    );
    expect(scalar("SELECT last_post_id AS n FROM threads WHERE id = ?1", thread.thread.id)).toBe(
      reply.id,
    );
    expect(scalar("SELECT last_post_at AS n FROM threads WHERE id = ?1", thread.thread.id)).toBe(
      Date.parse(reply.createdAt),
    );
    expect(scalar("SELECT last_poster_id AS n FROM threads WHERE id = ?1", thread.thread.id)).toBe(
      author.id,
    );
    expect(scalar("SELECT thread_count AS n FROM nodes WHERE id = ?1", forum.id)).toBe(1);
    expect(scalar("SELECT post_count AS n FROM nodes WHERE id = ?1", forum.id)).toBe(2);
    expect(scalar("SELECT last_post_id AS n FROM nodes WHERE id = ?1", forum.id)).toBe(reply.id);
    expect(scalar("SELECT last_post_at AS n FROM nodes WHERE id = ?1", forum.id)).toBe(
      Date.parse(reply.createdAt),
    );
    expect(scalar("SELECT last_thread_id AS n FROM nodes WHERE id = ?1", forum.id)).toBe(
      thread.thread.id,
    );
    expect(scalar("SELECT last_poster_id AS n FROM nodes WHERE id = ?1", forum.id)).toBe(author.id);
    expect(
      ctx.sqlite
        .prepare<{ last_thread_title: string }, [number]>(
          "SELECT last_thread_title FROM nodes WHERE id = ?1",
        )
        .get(forum.id)?.last_thread_title,
    ).toBe("Thread");
    expect(scalar("SELECT post_count AS n FROM users WHERE id = ?1", author.id)).toBe(2);
    expect(scalar("SELECT reaction_score AS n FROM users WHERE id = ?1", author.id)).toBe(3);
    expect(scalar("SELECT reaction_score AS n FROM users WHERE id = ?1", reactor.id)).toBe(1);
    expect(scalar("SELECT comment_count AS n FROM profile_posts WHERE id = ?1", profile.id)).toBe(
      1,
    );
    expect(
      scalar("SELECT message_count AS n FROM conversations WHERE id = ?1", conv.conversation.id),
    ).toBe(2);
    expect(
      scalar(
        "SELECT participant_count AS n FROM conversations WHERE id = ?1",
        conv.conversation.id,
      ),
    ).toBe(2);
    expect(
      scalar("SELECT last_message_id AS n FROM conversations WHERE id = ?1", conv.conversation.id),
    ).toBe(message.id);
    expect(
      scalar("SELECT last_message_at AS n FROM conversations WHERE id = ?1", conv.conversation.id),
    ).toBe(ctx.now());
    expect(
      scalar(
        "SELECT last_message_user_id AS n FROM conversations WHERE id = ?1",
        conv.conversation.id,
      ),
    ).toBe(author.id);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT COUNT(*) AS n FROM conversation_participants WHERE conversation_id = ?1 AND last_message_at = 0",
        )
        .get(conv.conversation.id)?.n,
    ).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ last_message_at: number }, [number, number]>(
          "SELECT last_message_at FROM conversation_participants WHERE conversation_id = ?1 AND user_id = ?2",
        )
        .get(conv.conversation.id, left.id)?.last_message_at,
    ).toBe(leftAt);
    for (const [table, id] of [
      ["posts", reply.id],
      ["profile_posts", profile.id],
      ["profile_post_comments", comment.id],
      ["conversation_messages", message.id],
    ] as const)
      expect(
        ctx.sqlite
          .prepare<{ reaction_counts: string }, [number]>(
            `SELECT reaction_counts FROM ${table} WHERE id = ?1`,
          )
          .get(id)?.reaction_counts,
      ).toBe('{"1":1}');
    expect(
      ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM jobs WHERE status = 'pending' AND type = 'rebuild-counters'",
        )
        .get()?.n,
    ).toBe(0);
    const guarded = [
      ["threads", "reply_count, first_post_id, last_post_at, last_post_id, last_poster_id"],
      [
        "nodes",
        "thread_count, post_count, last_post_at, last_post_id, last_thread_id, last_thread_title, last_poster_id",
      ],
      ["users", "post_count, reaction_score"],
      ["profile_posts", "comment_count, last_comment_at, reaction_counts"],
      [
        "conversations",
        "message_count, participant_count, last_message_at, last_message_id, last_message_user_id",
      ],
      ["conversation_participants", "last_message_at"],
      ["posts", "reaction_counts"],
      ["profile_post_comments", "reaction_counts"],
      ["conversation_messages", "reaction_counts"],
    ] as const;
    for (const [table, fields] of guarded)
      ctx.sqlite.exec(
        `CREATE TRIGGER no_rewrite_${table} BEFORE UPDATE OF ${fields} ON ${table} BEGIN SELECT RAISE(ABORT, 'correct row updated'); END`,
      );
    enqueueJob(
      ctx,
      "rebuild-counters",
      { stage: "threads", after: 0 },
      { uniqueKey: "rebuild-counters" },
    );
    expect(await runDueJobs(ctx, { limit: 100 })).toBeGreaterThanOrEqual(8);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM jobs WHERE type = 'rebuild-counters' AND status != 'done'",
        )
        .get()?.n,
    ).toBe(0);
  });

  test("rebuild respects hidden content, moved sticky threads, and the newest visible comment", async () => {
    const ctx = createTestContext();
    const author = insertUser(ctx);
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    const user = userActor(author);
    const source = insertNode(ctx, {});
    const target = insertNode(ctx, {});
    const moved = await execute(ctx, threadsCreateOp, user, {
      nodeId: source.id,
      title: "Moved",
      body: "first",
    });
    ctx.clock.advance(1);
    const visible = await execute(ctx, postsCreateOp, user, {
      threadId: moved.thread.id,
      body: "visible",
    });
    const deleted = await execute(ctx, postsCreateOp, user, {
      threadId: moved.thread.id,
      body: "deleted",
    });
    await execute(ctx, postsDeleteOp, moderator, { postId: deleted.id });
    const moderated = await execute(ctx, postsCreateOp, user, {
      threadId: moved.thread.id,
      body: "moderated",
    });
    ctx.sqlite.prepare("UPDATE posts SET state = 'moderated' WHERE id = ?1").run(moderated.id);
    const hiddenThread = await execute(ctx, threadsCreateOp, user, {
      nodeId: target.id,
      title: "Hidden",
      body: "hidden",
    });
    await execute(ctx, threadsDeleteOp, moderator, { threadId: hiddenThread.thread.id });
    await execute(ctx, threadsMoveOp, moderator, { threadId: moved.thread.id, nodeId: target.id });
    await execute(ctx, threadsSetStickyOp, moderator, {
      threadId: moved.thread.id,
      isSticky: true,
    });
    const wall = await execute(ctx, profilePostsCreateOp, user, {
      userId: author.id,
      body: "wall",
    });
    const first = await execute(ctx, profileCommentsCreateOp, user, {
      profilePostId: wall.id,
      body: "first",
    });
    ctx.clock.advance(1);
    const last = await execute(ctx, profileCommentsCreateOp, user, {
      profilePostId: wall.id,
      body: "last",
    });
    await execute(ctx, profileCommentsDeleteOp, moderator, { commentId: last.id });
    ctx.sqlite
      .prepare("UPDATE threads SET reply_count = 99, last_post_id = ?2 WHERE id = ?1")
      .run(moved.thread.id, moderated.id);
    ctx.sqlite
      .prepare(
        "UPDATE nodes SET thread_count = 99, post_count = 99, last_thread_id = NULL WHERE id IN (?1, ?2)",
      )
      .run(source.id, target.id);
    ctx.sqlite.prepare("UPDATE users SET post_count = 99 WHERE id = ?1").run(author.id);
    ctx.sqlite
      .prepare("UPDATE profile_posts SET comment_count = 99, last_comment_at = NULL WHERE id = ?1")
      .run(wall.id);
    registerJobHandlers(ctx);
    enqueueJob(
      ctx,
      "rebuild-counters",
      { stage: "threads", after: 0 },
      { uniqueKey: "rebuild-counters" },
    );
    await runDueJobs(ctx, { limit: 100 });
    const get = (sql: string, id: number) =>
      ctx.sqlite.prepare<{ n: number | null }, [number]>(sql).get(id)?.n;
    expect(get("SELECT reply_count AS n FROM threads WHERE id = ?1", moved.thread.id)).toBe(1);
    expect(get("SELECT last_post_id AS n FROM threads WHERE id = ?1", moved.thread.id)).toBe(
      visible.id,
    );
    expect(get("SELECT thread_count AS n FROM nodes WHERE id = ?1", source.id)).toBe(0);
    expect(get("SELECT post_count AS n FROM nodes WHERE id = ?1", source.id)).toBe(0);
    expect(get("SELECT thread_count AS n FROM nodes WHERE id = ?1", target.id)).toBe(1);
    expect(get("SELECT post_count AS n FROM nodes WHERE id = ?1", target.id)).toBe(2);
    expect(get("SELECT last_thread_id AS n FROM nodes WHERE id = ?1", target.id)).toBe(
      moved.thread.id,
    );
    expect(get("SELECT post_count AS n FROM users WHERE id = ?1", author.id)).toBe(2);
    expect(get("SELECT comment_count AS n FROM profile_posts WHERE id = ?1", wall.id)).toBe(1);
    expect(get("SELECT last_comment_at AS n FROM profile_posts WHERE id = ?1", wall.id)).toBe(
      Date.parse(first.createdAt),
    );
  });

  test("node rebuild picks the newest post across sticky and non-sticky threads", async () => {
    const ctx = createTestContext();
    const author = userActor(insertUser(ctx));
    const moderator = userActor(insertUser(ctx, { groupId: 3 }));
    for (const stickyFirst of [true, false]) {
      const forum = insertNode(ctx, {});
      invalidate(ctx, "node_tree");
      const first = await execute(ctx, threadsCreateOp, author, {
        nodeId: forum.id,
        title: "Older",
        body: "first",
      });
      ctx.clock.advance(1);
      const second = await execute(ctx, threadsCreateOp, author, {
        nodeId: forum.id,
        title: "Newer",
        body: "second",
      });
      await execute(ctx, threadsSetStickyOp, moderator, {
        threadId: stickyFirst ? first.thread.id : second.thread.id,
        isSticky: true,
      });
      ctx.sqlite
        .prepare("UPDATE nodes SET last_thread_id = NULL, last_thread_title = NULL WHERE id = ?1")
        .run(forum.id);
      expect(
        rebuildCountersChunk(ctx, { stage: "nodes", after: forum.id - 1 }, { enqueueNext: false }),
      ).toBe(1);
      expect(
        ctx.sqlite
          .prepare<{ last_thread_id: number; last_thread_title: string }, [number]>(
            "SELECT last_thread_id, last_thread_title FROM nodes WHERE id = ?1",
          )
          .get(forum.id),
      ).toMatchObject({ last_thread_id: second.thread.id, last_thread_title: "Newer" });
    }
  });
});
