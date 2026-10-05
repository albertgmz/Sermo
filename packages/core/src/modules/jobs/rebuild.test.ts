import { describe, expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { execute } from "../../operation";
import { conversationsCreateOp, conversationsReplyOp } from "../conversations";
import { postsCreateOp, threadsCreateOp } from "../forums";
import { profileCommentsCreateOp, profilePostsCreateOp } from "../profiles";
import { reactionsSetOp } from "../reactions";
import {
  enqueueJob,
  registerCounterRebuild,
  runDailyTasks,
  runDueJobs,
  runHourlyTasks,
  startScheduler,
} from "./index";

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

  test("rebuild restores all counter families from real operations and skips correct rows", async () => {
    const ctx = createTestContext();
    const author = insertUser(ctx);
    const reactor = insertUser(ctx);
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
      recipientIds: [reactor.id],
      body: "first",
    });
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
        "UPDATE conversation_participants SET last_message_at = 0 WHERE conversation_id = ?1",
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
    registerCounterRebuild(ctx);
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
      ctx.now(),
    );
    expect(scalar("SELECT last_poster_id AS n FROM threads WHERE id = ?1", thread.thread.id)).toBe(
      author.id,
    );
    expect(scalar("SELECT thread_count AS n FROM nodes WHERE id = ?1", forum.id)).toBe(1);
    expect(scalar("SELECT post_count AS n FROM nodes WHERE id = ?1", forum.id)).toBe(2);
    expect(scalar("SELECT last_post_id AS n FROM nodes WHERE id = ?1", forum.id)).toBe(reply.id);
    expect(scalar("SELECT last_post_at AS n FROM nodes WHERE id = ?1", forum.id)).toBe(ctx.now());
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
  });
});
