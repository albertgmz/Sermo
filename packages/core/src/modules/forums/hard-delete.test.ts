import { describe, expect, test } from "bun:test";
import { insertUser } from "@sermo/core/testing";
import { actorUserId, GUEST } from "../../actor";
import { ConflictError, ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { dispatchEvents } from "../../events";
import { registerCreditRuleJobs } from "../credit-events";
import { fillPosts, type World, world } from "../feed/fixtures.test";
import { runDueJobs } from "../jobs";
import { registerNotificationJobs } from "../notifications";

type Sqlite = World["ctx"]["sqlite"];
const count = (sqlite: Sqlite, sql: string, ...params: number[]) =>
  (sqlite.prepare<{ n: number }, number[]>(sql).get(...params) as { n: number }).n;
const user = (w: World, id: number) =>
  w.ctx.sqlite
    .prepare<
      { post_count: number; reaction_score: number; unread_notification_count: number },
      [number]
    >("SELECT post_count, reaction_score, unread_notification_count FROM users WHERE id = ?1")
    .get(id)!;
const node = (w: World) =>
  w.ctx.sqlite
    .prepare<{ thread_count: number; post_count: number; last_thread_id: number | null }, [number]>(
      "SELECT thread_count, post_count, last_thread_id FROM nodes WHERE id = ?1",
    )
    .get(w.open.id)!;

/** A thread of alice with a reply of bob, and everything that can hang off them. */
async function furnished(w: World) {
  const t = await w.thread(w.alice, w.open.id, "Doomed", "Opening [quote=1]x[/quote]");
  const reply = await w.reply(w.bob, t.thread.id, "A reply");
  const sql = w.ctx.sqlite;
  const first = t.post.id as number;
  // Reactions from carol on both posts and from bob on the opening post.
  await w.call("reactions.set", w.carol, {
    contentType: "post",
    contentId: first,
    reactionTypeId: 1,
  });
  await w.call("reactions.set", w.bob, {
    contentType: "post",
    contentId: first,
    reactionTypeId: 1,
  });
  await w.call("reactions.set", w.carol, {
    contentType: "post",
    contentId: reply.id,
    reactionTypeId: 1,
  });
  await w.call("bookmarks.set", w.carol, {
    contentType: "thread",
    contentId: t.thread.id,
    bookmarked: true,
  });
  await w.call("bookmarks.set", w.carol, {
    contentType: "post",
    contentId: reply.id,
    bookmarked: true,
  });
  await w.call("threads.watch", w.carol, { threadId: t.thread.id });
  await w.call("threads.setFeatured", w.mod, { threadId: t.thread.id, isFeatured: true });
  await w.call("reports.create", w.carol, {
    target: { type: "post", id: reply.id },
    reason: "spam",
  });
  await w.call("threads.markRead", w.carol, { threadId: t.thread.id, position: 1 });
  // Rows the operations above do not make on their own.
  const alert = sql.prepare(
    "INSERT INTO notifications (user_id, epoch, type, content_type, content_id, thread_id, created_at, updated_at, read_at) VALUES (?1, 0, 'thread.watched', ?2, ?3, ?4, 1, 1, ?5)",
  );
  alert.run(w.carolUser.id, "post", reply.id, t.thread.id, null);
  alert.run(w.carolUser.id, "post", first, t.thread.id, 5);
  alert.run(w.bobUser.id, "thread", t.thread.id, t.thread.id, null);
  sql.prepare("UPDATE users SET unread_notification_count = 2 WHERE id = ?1").run(w.carolUser.id);
  sql.prepare("UPDATE users SET unread_notification_count = 1 WHERE id = ?1").run(w.bobUser.id);
  sql
    .prepare(
      "INSERT INTO ip_log (user_id, ip, ip_net, action, content_type, content_id, created_at) VALUES (?1, '1.2.3.4', '1.2.3.4', 'post', 'post', ?2, 1)",
    )
    .run(w.bobUser.id, reply.id);
  sql
    .prepare(
      "INSERT INTO content_quotes (content_type, content_id, quoted_post_id, quoted_user_id, created_at) VALUES ('post', ?1, ?2, ?3, 1)",
    )
    .run(reply.id, first, w.aliceUser.id);
  sql
    .prepare(
      "INSERT INTO content_mentions (content_type, content_id, user_id, created_at) VALUES ('post', ?1, ?2, 1)",
    )
    .run(reply.id, w.carolUser.id);
  sql
    .prepare(
      "INSERT INTO post_revisions (post_id, editor_id, body_source, body_html, edited_at) VALUES (?1, ?2, 'old', '<p>old</p>', 1)",
    )
    .run(reply.id, w.bobUser.id);
  sql
    .prepare(
      "INSERT INTO content_spoilers (content_type, content_id, position, html) VALUES ('post', ?1, 0, '<p>s</p>')",
    )
    .run(reply.id);
  sql
    .prepare(
      "INSERT INTO thread_bans (thread_id, user_id, moderator_id, created_at) VALUES (?1, ?2, ?3, 1)",
    )
    .run(t.thread.id, w.bobUser.id, actorUserId(w.mod));
  sql
    .prepare(
      "INSERT INTO credit_rules (title, trigger, amount, created_at, updated_at) VALUES ('r', 'reply_posted', 5, 1, 1)",
    )
    .run();
  sql
    .prepare(
      "INSERT INTO credit_rule_applications (rule_id, user_id, source_type, source_id, amount, state, created_at) VALUES (1, ?1, 'post', ?2, 5, 'reverted', 1)",
    )
    .run(w.bobUser.id, reply.id);
  sql
    .prepare(
      "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at) VALUES ('local', 'k', 1, 'image/png', 'x', ?1, 'attachment', 'public', 1)",
    )
    .run(w.bobUser.id);
  sql
    .prepare(
      "INSERT INTO attachments (file_id, content_type, content_id, created_at) VALUES (1, 'post', ?1, 1)",
    )
    .run(reply.id);
  sql
    .prepare(
      "INSERT INTO rankings (kind, node_id, position, target_id, score) VALUES ('mostViewed', ?1, 1, ?2, 3)",
    )
    .run(w.open.id, t.thread.id);
  return { threadId: t.thread.id as number, first, reply: reply.id as number };
}

/** Rows that name the thread or either post, in every table the purge reaches. */
function leftovers(w: World, threadId: number, postIds: number[]) {
  const sql = w.ctx.sqlite;
  const posts = JSON.stringify(postIds);
  const one = (query: string, ...params: (string | number)[]) =>
    sql.prepare<{ n: number }, (string | number)[]>(query).get(...params)!.n;
  return {
    threads: one("SELECT count(*) AS n FROM threads WHERE id = ?1", threadId),
    posts: one("SELECT count(*) AS n FROM posts WHERE thread_id = ?1", threadId),
    bodies: one(
      "SELECT count(*) AS n FROM post_bodies WHERE post_id IN (SELECT value FROM json_each(?1))",
      posts,
    ),
    reactions: one(
      "SELECT count(*) AS n FROM reactions WHERE content_type = 'post' AND content_id IN (SELECT value FROM json_each(?1))",
      posts,
    ),
    bookmarks: one(
      "SELECT count(*) AS n FROM bookmarks WHERE (content_type = 'thread' AND content_id = ?1) OR (content_type = 'post' AND content_id IN (SELECT value FROM json_each(?2)))",
      threadId,
      posts,
    ),
    features: one("SELECT count(*) AS n FROM thread_features WHERE thread_id = ?1", threadId),
    watches: one("SELECT count(*) AS n FROM thread_watches WHERE thread_id = ?1", threadId),
    reads: one("SELECT count(*) AS n FROM thread_reads WHERE thread_id = ?1", threadId),
    reports: one(
      "SELECT count(*) AS n FROM report_groups WHERE target_type = 'post' AND target_id IN (SELECT value FROM json_each(?1))",
      posts,
    ),
    reportRows: one(
      "SELECT count(*) AS n FROM reports WHERE group_id NOT IN (SELECT id FROM report_groups)",
    ),
    alerts: one(
      "SELECT count(*) AS n FROM notifications WHERE thread_id = ?1 OR (content_type = 'post' AND content_id IN (SELECT value FROM json_each(?2)))",
      threadId,
      posts,
    ),
    quotes: one(
      "SELECT count(*) AS n FROM content_quotes WHERE (content_type = 'post' AND content_id IN (SELECT value FROM json_each(?1))) OR quoted_post_id IN (SELECT value FROM json_each(?1))",
      posts,
    ),
    mentions: one(
      "SELECT count(*) AS n FROM content_mentions WHERE content_type = 'post' AND content_id IN (SELECT value FROM json_each(?1))",
      posts,
    ),
    spoilers: one(
      "SELECT count(*) AS n FROM content_spoilers WHERE content_type = 'post' AND content_id IN (SELECT value FROM json_each(?1))",
      posts,
    ),
    revisions: one(
      "SELECT count(*) AS n FROM post_revisions WHERE post_id IN (SELECT value FROM json_each(?1))",
      posts,
    ),
    bans: one("SELECT count(*) AS n FROM thread_bans WHERE thread_id = ?1", threadId),
    credits: one(
      "SELECT count(*) AS n FROM credit_rule_applications WHERE (source_type = 'post' AND source_id IN (SELECT value FROM json_each(?1))) OR (source_type = 'thread' AND source_id = ?2)",
      posts,
      threadId,
    ),
    attachments: one(
      "SELECT count(*) AS n FROM attachments WHERE content_type = 'post' AND content_id IN (SELECT value FROM json_each(?1))",
      posts,
    ),
    rankings: one("SELECT count(*) AS n FROM rankings WHERE target_id = ?1", threadId),
    search: one(
      "SELECT count(*) AS n FROM search_fts WHERE rowid IN (SELECT value FROM json_each(?1))",
      posts,
    ),
  };
}

describe("threads.hardDelete", () => {
  test("removes the thread and everything that hangs off it, and keeps the counters right", async () => {
    const w = world();
    const { threadId, first, reply } = await furnished(w);
    // The doomed thread is alice's only one; a second thread keeps the forum's last post meaningful.
    const keep = await w.thread(w.alice, w.open.id, "Keeper");
    const before = leftovers(w, threadId, [first, reply]);
    expect(before.threads).toBe(1);
    expect(before.reactions).toBe(3);
    expect(before.search).toBe(2);
    await w.call("threads.delete", w.mod, { threadId });
    const soft = {
      alice: user(w, w.aliceUser.id),
      bob: user(w, w.bobUser.id),
      node: node(w),
    };
    // A soft delete already took the thread out of the counters; the reactions still count.
    expect(soft.alice.post_count).toBe(1);
    expect(soft.alice.reaction_score).toBe(2);
    expect(soft.bob.reaction_score).toBe(1);
    expect(soft.node.thread_count).toBe(1);

    const result = await w.call("threads.hardDelete", w.admin, { threadId, reason: "gone" });
    expect(result).toEqual({ completed: true, removedPosts: 2 });
    expect(
      Object.fromEntries(
        Object.entries(leftovers(w, threadId, [first, reply])).filter(([, n]) => n > 0),
      ),
    ).toEqual({});

    // Counters: the thread was already out of them, so only the reaction score moves.
    const after = { alice: user(w, w.aliceUser.id), bob: user(w, w.bobUser.id), node: node(w) };
    expect(after.node).toEqual(soft.node);
    expect(after.alice.post_count).toBe(soft.alice.post_count);
    expect(after.bob.post_count).toBe(soft.bob.post_count);
    expect(after.alice.reaction_score).toBe(0);
    expect(after.bob.reaction_score).toBe(0);
    // The unread alerts that went with it lowered the members' counters (read ones did not).
    expect(user(w, w.carolUser.id).unread_notification_count).toBe(1);
    expect(user(w, w.bobUser.id).unread_notification_count).toBe(0);
    // The address history stays; only the pointer to the post went.
    expect(
      w.ctx.sqlite
        .prepare<{ content_type: string | null; content_id: number | null }, []>(
          "SELECT content_type, content_id FROM ip_log",
        )
        .get(),
    ).toEqual({ content_type: null, content_id: null });
    // The thread is gone for everyone, administrators included; the other one is untouched.
    await expect(w.call("threads.get", w.admin, { threadId })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(w.call("posts.get", w.admin, { postId: first })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect((await w.call("threads.get", w.admin, { threadId: keep.thread.id })).thread.id).toBe(
      keep.thread.id,
    );
    // The two files were queued for deletion and unlinked.
    expect(
      count(w.ctx.sqlite, "SELECT count(*) AS n FROM jobs WHERE type = 'storage.deletePermanent'"),
    ).toBe(1);
  });

  test("the moderator log entry survives the thread and says what it was", async () => {
    const w = world();
    const { threadId } = await furnished(w);
    await w.call("threads.delete", w.mod, { threadId });
    await w.call("threads.hardDelete", w.admin, { threadId, reason: "illegal content" });
    const log = await w.call("moderatorLog.list", w.admin, { action: "thread.hardDelete" });
    expect(log.items).toHaveLength(1);
    expect(log.items[0]).toMatchObject({
      actorId: actorUserId(w.admin),
      targetType: "thread",
      targetId: threadId,
      reason: "illegal content",
      details: {
        title: "Doomed",
        authorId: w.aliceUser.id,
        removedPosts: 2,
        completed: true,
      },
    });
    // The earlier soft delete is in the log as well.
    const all = await w.call("moderatorLog.list", w.admin, { limit: 50 });
    expect(all.items.map((item: { action: string }) => item.action)).toContain("thread.delete");
  });

  test("refuses without the permission, for guests, and for a thread that is still live", async () => {
    const w = world();
    const { threadId } = await furnished(w);
    await expect(w.call("threads.hardDelete", GUEST, { threadId })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(w.call("threads.hardDelete", w.alice, { threadId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // A moderator may soft-delete but is not allowed to delete for good by default.
    await expect(w.call("threads.hardDelete", w.mod, { threadId })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // Live content: even an administrator must delete it first.
    await expect(w.call("threads.hardDelete", w.admin, { threadId })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(count(w.ctx.sqlite, "SELECT count(*) AS n FROM threads WHERE id = ?1", threadId)).toBe(
      1,
    );
    // A thread awaiting approval is not deleted either.
    w.ctx.sqlite.prepare("UPDATE threads SET state = 'moderated' WHERE id = ?1").run(threadId);
    await expect(w.call("threads.hardDelete", w.admin, { threadId })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  test("is judged per forum: a moderator granted it in one forum may use it only there", async () => {
    const w = world();
    const other = (await import("@sermo/core/testing")).insertNode(w.ctx, {
      parentId: w.category.id,
    });
    const { invalidate } = await import("../../context");
    invalidate(w.ctx, "node_tree");
    const here = await w.thread(w.alice, w.open.id, "Here");
    const there = await w.thread(w.alice, other.id, "There");
    await w.call("permissions.set", w.admin, {
      groupId: 3,
      nodeId: w.open.id,
      entries: [{ permission: "forum.hardDelete", value: "allow" }],
    });
    for (const id of [here.thread.id, there.thread.id])
      await w.call("threads.delete", w.mod, { threadId: id });
    await expect(
      w.call("threads.hardDelete", w.mod, { threadId: there.thread.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await w.call("threads.hardDelete", w.mod, { threadId: here.thread.id })).toEqual({
      completed: true,
      removedPosts: 1,
    });
  });

  test("takes back the credits a reply still holds, with a ledger row, before it goes", async () => {
    const w = world();
    const { threadId, reply } = await furnished(w);
    await w.call("threads.delete", w.mod, { threadId });
    w.ctx.sqlite.prepare("UPDATE credit_rule_applications SET state = 'applied'").run();
    w.ctx.sqlite.prepare("UPDATE users SET credits = 5 WHERE id = ?1").run(w.bobUser.id);
    await w.call("threads.hardDelete", w.admin, { threadId });
    expect(
      w.ctx.sqlite
        .prepare<{ credits: number }, [number]>("SELECT credits FROM users WHERE id = ?1")
        .get(w.bobUser.id)!.credits,
    ).toBe(0);
    expect(
      w.ctx.sqlite
        .prepare<{ type: string; amount: number; source_type: string }, []>(
          "SELECT type, amount, source_type FROM credit_transactions",
        )
        .all(),
    ).toEqual([{ type: "event_reversal", amount: -5, source_type: "credit_rule" }]);
    expect(count(w.ctx.sqlite, "SELECT count(*) AS n FROM posts WHERE id = ?1", reply)).toBe(0);
  });

  test("a large thread goes in chunks of 500 posts, newest first, and stays until the last", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Huge");
    fillPosts(w.ctx, t.thread.id, w.bobUser.id, 1100);
    w.ctx.sqlite.prepare("UPDATE threads SET reply_count = 1100 WHERE id = ?1").run(t.thread.id);
    await w.call("threads.delete", w.mod, { threadId: t.thread.id });
    const posts = () =>
      count(w.ctx.sqlite, "SELECT count(*) AS n FROM posts WHERE thread_id = ?1", t.thread.id);
    expect(await w.call("threads.hardDelete", w.admin, { threadId: t.thread.id })).toEqual({
      completed: false,
      removedPosts: 500,
    });
    expect(posts()).toBe(601);
    // The newest posts went; the opening post is still there and the thread is still deleted.
    expect(
      count(
        w.ctx.sqlite,
        "SELECT count(*) AS n FROM posts WHERE thread_id = ?1 AND position > 600",
        t.thread.id,
      ),
    ).toBe(0);
    expect(
      w.ctx.sqlite
        .prepare<{ state: string; reply_count: number }, [number]>(
          "SELECT state, reply_count FROM threads WHERE id = ?1",
        )
        .get(t.thread.id),
    ).toEqual({ state: "deleted", reply_count: 600 });
    expect(await w.call("threads.hardDelete", w.admin, { threadId: t.thread.id })).toMatchObject({
      completed: false,
      removedPosts: 500,
    });
    expect(await w.call("threads.hardDelete", w.admin, { threadId: t.thread.id })).toEqual({
      completed: true,
      removedPosts: 101,
    });
    expect(posts()).toBe(0);
    expect(
      count(w.ctx.sqlite, "SELECT count(*) AS n FROM threads WHERE id = ?1", t.thread.id),
    ).toBe(0);
    // One log entry per call.
    expect(
      count(
        w.ctx.sqlite,
        "SELECT count(*) AS n FROM moderator_log WHERE action = 'thread.hardDelete'",
      ),
    ).toBe(3);
  });

  test("refuses a thread with a transfer pending", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Busy");
    await w.call("threads.delete", w.mod, { threadId: t.thread.id });
    w.ctx.sqlite
      .prepare(
        "INSERT INTO thread_transfers (thread_id, role, other_thread_id, job_key, created_at) VALUES (?1, 'merge_target', 99, 'k', 1)",
      )
      .run(t.thread.id);
    await expect(
      w.call("threads.hardDelete", w.admin, { threadId: t.thread.id }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("posts.hardDelete", () => {
  test("removes a soft-deleted reply and what hangs off it, leaving the others where they are", async () => {
    const w = world();
    const { threadId, first, reply } = await furnished(w);
    const later = await w.reply(w.carol, threadId, "Later");
    await w.call("posts.delete", w.bob, { postId: reply });
    const soft = {
      thread: w.ctx.sqlite
        .prepare<{ reply_count: number }, [number]>("SELECT reply_count FROM threads WHERE id = ?1")
        .get(threadId)!,
      bob: user(w, w.bobUser.id),
      node: node(w),
    };
    await expect(w.call("posts.hardDelete", w.mod, { postId: reply })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await w.call("posts.hardDelete", w.admin, { postId: reply, reason: "doxxing" })).toEqual(
      {
        ok: true,
      },
    );
    const gone = leftovers(w, threadId, [reply]);
    expect(gone).toMatchObject({
      bodies: 0,
      reactions: 0,
      bookmarks: 1, // the thread bookmark stays; the post one went
      reports: 0,
      quotes: 0,
      mentions: 0,
      credits: 0,
      attachments: 0,
      search: 0,
    });
    expect(gone.posts).toBe(2);
    // Counters stay where the soft delete left them; carol's reaction on it gave its point back.
    expect(
      w.ctx.sqlite
        .prepare<{ reply_count: number }, [number]>("SELECT reply_count FROM threads WHERE id = ?1")
        .get(threadId),
    ).toEqual(soft.thread);
    expect(user(w, w.bobUser.id).post_count).toBe(soft.bob.post_count);
    expect(user(w, w.bobUser.id).reaction_score).toBe(soft.bob.reaction_score - 1);
    expect(node(w)).toEqual(soft.node);
    // The other posts did not move.
    const posts = await w.call("posts.list", w.admin, { threadId });
    expect(posts.items.map((p: { id: number; position: number }) => [p.id, p.position])).toEqual([
      [first, 0],
      [later.id, 2],
    ]);
    expect(
      (await w.call("moderatorLog.list", w.admin, { action: "post.hardDelete" })).items[0],
    ).toMatchObject({ targetId: reply, reason: "doxxing", details: { threadId } });
    await expect(w.call("posts.get", w.admin, { postId: reply })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  test("refuses a live post, the opening post, and a guest", async () => {
    const w = world();
    const { first, reply } = await furnished(w);
    await expect(w.call("posts.hardDelete", w.admin, { postId: reply })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(w.call("posts.hardDelete", GUEST, { postId: reply })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(w.call("posts.hardDelete", w.admin, { postId: first })).rejects.toThrow(
      "Delete the thread instead.",
    );
    expect(count(w.ctx.sqlite, "SELECT count(*) AS n FROM posts WHERE id = ?1", reply)).toBe(1);
  });
});

describe("profilePosts.hardDelete", () => {
  test("removes a deleted profile post with its comments and what hangs off them", async () => {
    const w = world();
    const post = await w.wall(w.alice, w.bobUser.id, "On the wall");
    const comment = await w.call("profileComments.create", w.carol, {
      profilePostId: post.id,
      body: "Nice",
    });
    await w.call("reactions.set", w.bob, {
      contentType: "profile_post_comment",
      contentId: comment.id,
      reactionTypeId: 1,
    });
    await w.call("reactions.set", w.carol, {
      contentType: "profile_post",
      contentId: post.id,
      reactionTypeId: 1,
    });
    await w.call("reports.create", w.bob, {
      target: { type: "profile_post", id: post.id },
      reason: "rude",
    });
    expect(user(w, w.aliceUser.id).reaction_score).toBe(1);
    expect(user(w, w.carolUser.id).reaction_score).toBe(1);
    await expect(
      w.call("profilePosts.hardDelete", w.admin, { profilePostId: post.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    await w.call("profilePosts.delete", w.mod, { profilePostId: post.id });
    await expect(
      w.call("profilePosts.hardDelete", w.mod, { profilePostId: post.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // Its author no longer sees it, so for them it is not there at all.
    await expect(
      w.call("profilePosts.hardDelete", w.alice, { profilePostId: post.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await w.call("profilePosts.hardDelete", w.admin, { profilePostId: post.id, reason: "x" }),
    ).toEqual({ completed: true, removedComments: 1 });
    for (const table of [
      "profile_posts",
      "profile_post_comments",
      "reactions",
      "report_groups",
      "reports",
    ])
      expect(count(w.ctx.sqlite, `SELECT count(*) AS n FROM ${table}`)).toBe(0);
    expect(user(w, w.aliceUser.id).reaction_score).toBe(0);
    expect(user(w, w.carolUser.id).reaction_score).toBe(0);
    expect(
      (await w.call("moderatorLog.list", w.admin, { action: "profile_post.hardDelete" })).items[0],
    ).toMatchObject({
      targetId: post.id,
      details: {
        authorId: w.aliceUser.id,
        profileUserId: w.bobUser.id,
        removedComments: 1,
        completed: true,
      },
    });
  });

  test("a wall with many comments goes in chunks", async () => {
    const w = world();
    const post = await w.wall(w.alice, w.bobUser.id, "Busy wall");
    const insert = w.ctx.sqlite.prepare(
      "INSERT INTO profile_post_comments (profile_post_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?2, 'visible', 1, 'c', '<p>c</p>')",
    );
    for (let i = 0; i < 520; i++) insert.run(post.id, w.carolUser.id);
    await w.call("profilePosts.delete", w.admin, { profilePostId: post.id });
    expect(await w.call("profilePosts.hardDelete", w.admin, { profilePostId: post.id })).toEqual({
      completed: false,
      removedComments: 500,
    });
    expect(count(w.ctx.sqlite, "SELECT count(*) AS n FROM profile_posts")).toBe(1);
    expect(await w.call("profilePosts.hardDelete", w.admin, { profilePostId: post.id })).toEqual({
      completed: true,
      removedComments: 20,
    });
    expect(count(w.ctx.sqlite, "SELECT count(*) AS n FROM profile_posts")).toBe(0);
  });
});

describe("profileComments.hardDelete", () => {
  test("removes one deleted comment with its reactions, reports, alerts and files, and leaves the post and the other comments", async () => {
    const w = world();
    const post = await w.wall(w.alice, w.bobUser.id, "On the wall");
    const comment = await w.call("profileComments.create", w.carol, {
      profilePostId: post.id,
      body: "Nice",
    });
    const kept = await w.call("profileComments.create", w.bob, {
      profilePostId: post.id,
      body: "Kept",
    });
    await w.call("reactions.set", w.bob, {
      contentType: "profile_post_comment",
      contentId: comment.id,
      reactionTypeId: 1,
    });
    await w.call("reports.create", w.bob, {
      target: { type: "profile_post_comment", id: comment.id },
      reason: "rude",
    });
    const sql = w.ctx.sqlite;
    sql
      .prepare(
        "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, uploader_id, purpose, visibility, created_at) VALUES ('local', 'k', 1, 'image/png', 'x', ?1, 'attachment', 'public', 1)",
      )
      .run(w.carolUser.id);
    sql
      .prepare(
        "INSERT INTO attachments (file_id, content_type, content_id, created_at) VALUES (1, 'profile_post_comment', ?1, 1)",
      )
      .run(comment.id);
    sql
      .prepare(
        "INSERT INTO notifications (user_id, epoch, type, content_type, content_id, created_at, updated_at, read_at) VALUES (?1, 0, 'mention', 'profile_post_comment', ?2, 1, 1, NULL)",
      )
      .run(w.aliceUser.id, comment.id);
    sql.prepare("UPDATE users SET unread_notification_count = 1 WHERE id = ?1").run(w.aliceUser.id);
    const commentCount = () =>
      count(sql, "SELECT comment_count AS n FROM profile_posts WHERE id = ?1", post.id);
    expect(commentCount()).toBe(2);
    expect(user(w, w.carolUser.id).reaction_score).toBe(1);

    await expect(
      w.call("profileComments.hardDelete", w.admin, { commentId: comment.id }),
    ).rejects.toBeInstanceOf(ConflictError);
    await w.call("profileComments.delete", w.admin, { commentId: comment.id });
    expect(commentCount()).toBe(1);
    // The wall's owner and a moderator may hide it, not erase it; the author sees nothing.
    await expect(
      w.call("profileComments.hardDelete", w.bob, { commentId: comment.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      w.call("profileComments.hardDelete", w.mod, { commentId: comment.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      w.call("profileComments.hardDelete", GUEST, { commentId: comment.id }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(count(sql, "SELECT count(*) AS n FROM profile_post_comments")).toBe(2);

    await w.call("profileComments.hardDelete", w.admin, { commentId: comment.id, reason: "x" });

    for (const [table, where] of [
      ["profile_post_comments", `id = ${comment.id}`],
      ["reactions", "content_type = 'profile_post_comment'"],
      ["report_groups", "target_type = 'profile_post_comment'"],
      ["attachments", "content_type = 'profile_post_comment'"],
      ["notifications", "content_type = 'profile_post_comment'"],
    ])
      expect(count(sql, `SELECT count(*) AS n FROM ${table} WHERE ${where}`), table).toBe(0);
    expect(commentCount()).toBe(1);
    expect(user(w, w.carolUser.id).reaction_score).toBe(0);
    expect(user(w, w.aliceUser.id).unread_notification_count).toBe(0);
    expect(count(sql, "SELECT count(*) AS n FROM profile_posts WHERE id = ?1", post.id)).toBe(1);
    expect(
      count(sql, "SELECT count(*) AS n FROM profile_post_comments WHERE id = ?1", kept.id),
    ).toBe(1);
    expect(
      (await w.call("moderatorLog.list", w.admin, { action: "profile_comment.hardDelete" }))
        .items[0],
    ).toMatchObject({ targetId: comment.id, details: { authorId: w.carolUser.id } });
  });

  test("a visible comment's count is lowered once, by the soft delete, and erasing a hidden one leaves it alone", async () => {
    const w = world();
    const post = await w.wall(w.alice, w.bobUser.id, "On the wall");
    const first = await w.call("profileComments.create", w.carol, {
      profilePostId: post.id,
      body: "One",
    });
    await w.call("profileComments.create", w.carol, { profilePostId: post.id, body: "Two" });
    await w.call("profileComments.delete", w.admin, { commentId: first.id });
    await w.call("profileComments.hardDelete", w.admin, { commentId: first.id });
    expect(
      count(w.ctx.sqlite, "SELECT comment_count AS n FROM profile_posts WHERE id = ?1", post.id),
    ).toBe(1);
  });
});

describe("hard delete and credits, through the real event pipeline", () => {
  const paid = async () => {
    const w = world();
    await w.call("creditRules.create", w.admin, {
      title: "Reply",
      trigger: "reply_posted",
      amount: 10,
    });
    registerCreditRuleJobs(w.ctx);
    const t = await w.thread(w.alice, w.open.id, "Paid");
    const reply = await w.reply(w.bob, t.thread.id, "Worth ten");
    await dispatchEvents(w.ctx);
    const credits = (userId: number) =>
      w.ctx.sqlite
        .prepare<{ credits: number }, [number]>("SELECT credits FROM users WHERE id = ?1")
        .get(userId)!.credits;
    expect(credits(w.bobUser.id)).toBe(10);
    return { w, t, reply, credits };
  };

  test("a deleted post goes at once, even before the soft delete event was handled", async () => {
    const { w, reply, credits } = await paid();
    await w.call("posts.delete", w.bob, { postId: reply.id });
    await w.call("posts.hardDelete", w.admin, { postId: reply.id });
    // The hard delete took the credits back itself, with a ledger row.
    expect(credits(w.bobUser.id)).toBe(0);
    expect(count(w.ctx.sqlite, "SELECT count(*) AS n FROM credit_rule_applications")).toBe(0);
    expect(count(w.ctx.sqlite, "SELECT count(*) AS n FROM credit_transactions")).toBe(2);
    // The queued events find the content gone and change nothing.
    await dispatchEvents(w.ctx);
    expect(credits(w.bobUser.id)).toBe(0);
    expect(count(w.ctx.sqlite, "SELECT count(*) AS n FROM credit_transactions")).toBe(2);
  });

  test("a deleted thread goes although its replies kept their credits", async () => {
    const { w, t, credits } = await paid();
    await w.call("threads.delete", w.mod, { threadId: t.thread.id });
    await dispatchEvents(w.ctx);
    // Deleting the thread reverts what the thread paid; its reply still holds its credits.
    expect(credits(w.bobUser.id)).toBe(10);
    await w.call("threads.hardDelete", w.admin, { threadId: t.thread.id });
    expect(credits(w.bobUser.id)).toBe(0);
    expect(count(w.ctx.sqlite, "SELECT count(*) AS n FROM credit_rule_applications")).toBe(0);
    await dispatchEvents(w.ctx);
    expect(credits(w.bobUser.id)).toBe(0);
  });

  test("the events of purged content stay, so a later event is still delivered", async () => {
    const { w, t, reply, credits } = await paid();
    await w.call("posts.delete", w.bob, { postId: reply.id });
    await dispatchEvents(w.ctx);
    const newest = () => count(w.ctx.sqlite, "SELECT max(id) AS n FROM domain_events");
    const before = newest();
    await w.call("posts.hardDelete", w.admin, { postId: reply.id });
    expect(newest()).toBeGreaterThanOrEqual(before);
    await w.reply(w.carol, t.thread.id, "After");
    await dispatchEvents(w.ctx);
    expect(credits(w.carolUser.id)).toBe(10);
  });
});

describe("what a purge must not leave behind", () => {
  test("the alerts about a post's reports go with the reports, and unread counters follow", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "T");
    const reply = await w.reply(w.bob, t.thread.id, "R");
    await w.call("reports.create", w.carol, {
      target: { type: "post", id: reply.id },
      reason: "spam",
    });
    const group = w.ctx.sqlite
      .prepare<{ id: number }, []>("SELECT id FROM report_groups")
      .get()!.id;
    w.ctx.sqlite
      .prepare(
        "INSERT INTO notifications (user_id, epoch, type, content_type, content_id, created_at, updated_at) VALUES (?1, 0, 'moderator.report', 'report_group', ?2, 1, 1)",
      )
      .run(w.aliceUser.id, group);
    w.ctx.sqlite
      .prepare("UPDATE users SET unread_notification_count = 1 WHERE id = ?1")
      .run(w.aliceUser.id);
    const report = w.ctx.sqlite.prepare<{ id: number }, []>("SELECT id FROM reports").get()!.id;
    w.ctx.sqlite
      .prepare(
        "INSERT INTO ip_log (user_id, ip, ip_net, action, content_type, content_id, created_at) VALUES (?1, '1.1.1.1', '1.1.1.1', 'report', 'report', ?2, 1)",
      )
      .run(w.carolUser.id, report);
    await w.call("posts.delete", w.bob, { postId: reply.id });
    await w.call("posts.hardDelete", w.admin, { postId: reply.id });
    expect(count(w.ctx.sqlite, "SELECT count(*) AS n FROM notifications")).toBe(0);
    expect(user(w, w.aliceUser.id).unread_notification_count).toBe(0);
    expect(
      w.ctx.sqlite
        .prepare<{ content_type: string | null }, []>("SELECT content_type FROM ip_log")
        .get(),
    ).toEqual({ content_type: null });
  });

  test("a read marker cannot point past what is left, so a reused id is not read already", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "T");
    const reply = await w.reply(w.bob, t.thread.id, "R");
    await w.call("threads.markRead", w.carol, { threadId: t.thread.id, position: 1 });
    expect(
      count(
        w.ctx.sqlite,
        "SELECT last_read_post_id AS n FROM thread_reads WHERE user_id = ?1",
        w.carolUser.id,
      ),
    ).toBe(reply.id);
    await w.call("posts.delete", w.bob, { postId: reply.id });
    await w.call("posts.hardDelete", w.admin, { postId: reply.id });
    expect(
      count(
        w.ctx.sqlite,
        "SELECT last_read_post_id AS n FROM thread_reads WHERE user_id = ?1",
        w.carolUser.id,
      ),
    ).toBe(t.post.id);
    const next = await w.reply(w.carol, t.thread.id, "Next");
    // SQLite gave the removed post's id to the new one; the reader's marker is still below it.
    expect(next.id).toBe(reply.id);
    expect(
      count(
        w.ctx.sqlite,
        "SELECT count(*) AS n FROM thread_reads WHERE user_id = ?2 AND last_read_post_id < ?1",
        next.id,
        w.bobUser.id,
      ),
    ).toBe(1);
  });
});

describe("the cost of a purge", () => {
  test("thousands of unread alerts on one post cost time in proportion, not squared", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Popular");
    const reply = await w.reply(w.bob, t.thread.id, "Everyone follows this");
    const sql = w.ctx.sqlite;
    const members = Array.from({ length: 4000 }, () => insertUser(w.ctx).id);
    const alert = sql.prepare(
      "INSERT INTO notifications (user_id, epoch, type, content_type, content_id, thread_id, created_at, updated_at) VALUES (?1, 0, 'thread.watched', 'post', ?2, ?3, 1, 1)",
    );
    for (const id of members) alert.run(id, reply.id, t.thread.id);
    sql
      .prepare(
        "UPDATE users SET unread_notification_count = 1 WHERE id IN (SELECT value FROM json_each(?1))",
      )
      .run(JSON.stringify(members));
    await w.call("posts.delete", w.bob, { postId: reply.id });
    const started = performance.now();
    await w.call("posts.hardDelete", w.admin, { postId: reply.id });
    const took = performance.now() - started;
    expect(count(sql, "SELECT count(*) AS n FROM notifications")).toBe(0);
    expect(count(sql, "SELECT sum(unread_notification_count) AS n FROM users")).toBe(0);
    // The correlated form of the counter update took 3.5 s for these 4,000 members; the join, a few ms.
    expect(took).toBeLessThan(1000);
  });
});

describe("a removed row's id given to a new one", () => {
  test("the new post still pays its credits, whatever the removed one went through", async () => {
    const w = world();
    await w.call("creditRules.create", w.admin, {
      title: "Reply",
      trigger: "reply_posted",
      amount: 10,
    });
    registerCreditRuleJobs(w.ctx);
    const t = await w.thread(w.alice, w.open.id, "Reuse");
    // The old post waits for approval, is approved, deleted and removed: its events say
    // "moderated" first, which would make a later post of the same id look like a held one.
    w.ctx.sqlite
      .prepare("UPDATE nodes SET require_reply_approval = 1 WHERE id = ?1")
      .run(w.open.id);
    const old = await w.reply(w.bob, t.thread.id, "Held at first");
    w.ctx.sqlite
      .prepare("UPDATE nodes SET require_reply_approval = 0 WHERE id = ?1")
      .run(w.open.id);
    await w.call("moderation.setState", w.admin, {
      target: { type: "post", id: old.id },
      state: "visible",
    });
    await dispatchEvents(w.ctx);
    await w.call("moderation.setState", w.admin, {
      target: { type: "post", id: old.id },
      state: "deleted",
    });
    await dispatchEvents(w.ctx);
    await w.call("posts.hardDelete", w.admin, { postId: old.id });
    const next = await w.reply(w.carol, t.thread.id, "Takes the id");
    expect(next.id).toBe(old.id);
    await dispatchEvents(w.ctx);
    expect(
      w.ctx.sqlite
        .prepare<{ credits: number }, [number]>("SELECT credits FROM users WHERE id = ?1")
        .get(w.carolUser.id)!.credits,
    ).toBe(10);
  });
});

describe("merge tombstones of a removed thread", () => {
  test("go with it, however many merges deep, so no old address can open another thread", async () => {
    const w = world();
    const a = (await w.thread(w.alice, w.open.id, "A")).thread.id as number;
    const b = (await w.thread(w.alice, w.open.id, "B")).thread.id as number;
    const c = (await w.thread(w.alice, w.open.id, "C")).thread.id as number;
    const keep = (await w.thread(w.alice, w.open.id, "Keeper")).thread.id as number;
    await w.call("bookmarks.set", w.carol, {
      contentType: "thread",
      contentId: a,
      bookmarked: true,
    });
    // A into B, then B (with A's address) into C.
    expect(
      (await w.call("threads.merge", w.admin, { threadId: b, sourceThreadIds: [a] })).completed,
    ).toBe(true);
    expect(
      (await w.call("threads.merge", w.admin, { threadId: c, sourceThreadIds: [b] })).completed,
    ).toBe(true);
    expect((await w.call("threads.get", w.admin, { threadId: a })).thread.id).toBe(c);
    await w.call("threads.delete", w.admin, { threadId: c });
    await w.call("threads.hardDelete", w.admin, { threadId: c });
    const left = w.ctx.sqlite
      .prepare<{ id: number }, []>("SELECT id FROM threads ORDER BY id")
      .all()
      .map((row) => row.id);
    expect(left).toEqual([keep]);
    expect(count(w.ctx.sqlite, "SELECT count(*) AS n FROM bookmarks")).toBe(0);
    for (const id of [a, b, c])
      await expect(w.call("threads.get", w.admin, { threadId: id })).rejects.toBeInstanceOf(
        NotFoundError,
      );
  });
});

describe("a thread whose removal has begun", () => {
  test("cannot be brought back by any route, until it is gone", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Half gone");
    fillPosts(w.ctx, t.thread.id, w.bobUser.id, 600);
    await w.call("threads.delete", w.mod, { threadId: t.thread.id });
    // Before it begins, restoring is allowed (and undone again here).
    await w.call("threads.restore", w.mod, { threadId: t.thread.id });
    await w.call("threads.delete", w.mod, { threadId: t.thread.id });
    expect(await w.call("threads.hardDelete", w.admin, { threadId: t.thread.id })).toMatchObject({
      completed: false,
    });
    const refused = /being deleted for good/;
    await expect(w.call("threads.restore", w.mod, { threadId: t.thread.id })).rejects.toThrow(
      refused,
    );
    await expect(
      w.call("moderation.setState", w.admin, {
        target: { type: "thread", id: t.thread.id },
        state: "visible",
      }),
    ).rejects.toThrow(refused);
    await expect(
      w.call("moderation.bulk", w.admin, {
        targets: [{ type: "thread", id: t.thread.id }],
        action: "restore",
      }),
    ).rejects.toThrow(refused);
    const batch = await w.call("threads.batchUpdate", w.mod, {
      threadIds: [t.thread.id],
      update: { action: "restore" },
    });
    expect(batch.results[0].error).toMatchObject({ code: "conflict" });
    expect(batch.results[0].error.message).toMatch(refused);
    expect(
      w.ctx.sqlite
        .prepare<{ state: string }, [number]>("SELECT state FROM threads WHERE id = ?1")
        .get(t.thread.id),
    ).toEqual({ state: "deleted" });
  });

  test("is not merged into another thread, nor another thread into it", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "Half gone");
    const other = await w.thread(w.alice, w.open.id, "Still here");
    fillPosts(w.ctx, t.thread.id, w.bobUser.id, 600);
    await w.call("threads.delete", w.mod, { threadId: t.thread.id });
    expect(await w.call("threads.hardDelete", w.admin, { threadId: t.thread.id })).toMatchObject({
      completed: false,
    });
    const refused = /being deleted for good/;
    await expect(
      w.call("threads.merge", w.admin, {
        threadId: other.thread.id,
        sourceThreadIds: [t.thread.id],
      }),
    ).rejects.toThrow(refused);
    await expect(
      w.call("threads.merge", w.admin, {
        threadId: t.thread.id,
        sourceThreadIds: [other.thread.id],
      }),
    ).rejects.toThrow(refused);
  });
});

describe("who may not delete for good", () => {
  test("posts: guests are asked to sign in, members and the author see nothing, a moderator is refused", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "T");
    const reply = await w.reply(w.bob, t.thread.id, "R");
    await w.call("posts.delete", w.bob, { postId: reply.id });
    const attempt = (actor: Parameters<World["call"]>[1]) =>
      w.call("posts.hardDelete", actor, { postId: reply.id });
    await expect(attempt(GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
    // A deleted post is not visible to its author or to other members: it is not there for them.
    await expect(attempt(w.bob)).rejects.toBeInstanceOf(NotFoundError);
    await expect(attempt(w.carol)).rejects.toBeInstanceOf(NotFoundError);
    await expect(attempt(w.mod)).rejects.toBeInstanceOf(ForbiddenError);
    expect(count(w.ctx.sqlite, "SELECT count(*) AS n FROM posts WHERE id = ?1", reply.id)).toBe(1);
  });

  test("a forum the member cannot see: not found, not forbidden", async () => {
    const w = world();
    const t = await w.thread(w.admin, w.secret.id, "Hidden");
    const reply = await w.reply(w.admin, t.thread.id, "R");
    await w.call("posts.delete", w.admin, { postId: reply.id });
    await w.call("threads.delete", w.admin, { threadId: t.thread.id });
    await expect(w.call("posts.hardDelete", w.carol, { postId: reply.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(
      w.call("threads.hardDelete", w.carol, { threadId: t.thread.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("profile posts: guests, members and moderators are refused", async () => {
    const w = world();
    const post = await w.wall(w.alice, w.bobUser.id, "On the wall");
    await w.call("profilePosts.delete", w.alice, { profilePostId: post.id });
    const attempt = (actor: Parameters<World["call"]>[1]) =>
      w.call("profilePosts.hardDelete", actor, { profilePostId: post.id });
    await expect(attempt(GUEST)).rejects.toBeInstanceOf(UnauthenticatedError);
    // Members cannot see a deleted post; the moderator can, and may not delete it for good.
    await expect(attempt(w.carol)).rejects.toBeInstanceOf(NotFoundError);
    await expect(attempt(w.bob)).rejects.toBeInstanceOf(NotFoundError);
    await expect(attempt(w.mod)).rejects.toBeInstanceOf(ForbiddenError);
    expect(count(w.ctx.sqlite, "SELECT count(*) AS n FROM profile_posts")).toBe(1);
  });
});

describe("a removed report's id given to a new one", () => {
  test("the moderators are alerted to the new report, not told it is old news", async () => {
    const w = world();
    registerNotificationJobs(w.ctx);
    const t = await w.thread(w.alice, w.open.id, "T");
    const first = await w.reply(w.bob, t.thread.id, "Spam");
    await w.call("reports.create", w.carol, {
      target: { type: "post", id: first.id },
      reason: "spam",
    });
    await dispatchEvents(w.ctx);
    await runDueJobs(w.ctx);
    const alerts = () =>
      count(
        w.ctx.sqlite,
        "SELECT count(*) AS n FROM notifications WHERE type = 'moderator.report'",
      );
    expect(alerts()).toBeGreaterThan(0);
    await w.call("posts.delete", w.bob, { postId: first.id });
    await w.call("posts.hardDelete", w.admin, { postId: first.id });
    expect(alerts()).toBe(0);
    const second = await w.reply(w.bob, t.thread.id, "More spam");
    await w.call("reports.create", w.carol, {
      target: { type: "post", id: second.id },
      reason: "spam again",
    });
    // SQLite gave the removed report group's id to the new one.
    expect(count(w.ctx.sqlite, "SELECT id AS n FROM report_groups")).toBe(1);
    await dispatchEvents(w.ctx);
    await runDueJobs(w.ctx);
    expect(alerts()).toBeGreaterThan(0);
  });
});

describe("a thread or wall post whose removal has begun", () => {
  test("a thread made by a split that took a removed thread's id, with an older date, can be restored", async () => {
    const w = world();
    const p = await w.thread(w.alice, w.open.id, "Parent");
    const reply = await w.reply(w.bob, p.thread.id, "Moves out");
    const x = await w.thread(w.alice, w.open.id, "Big");
    fillPosts(w.ctx, x.thread.id, w.bobUser.id, 600);
    await w.call("threads.delete", w.mod, { threadId: x.thread.id });
    expect(await w.call("threads.hardDelete", w.admin, { threadId: x.thread.id })).toMatchObject({
      completed: false,
    });
    expect(await w.call("threads.hardDelete", w.admin, { threadId: x.thread.id })).toMatchObject({
      completed: true,
    });
    const split = await w.call("threads.split", w.admin, {
      threadId: p.thread.id,
      postIds: [reply.id],
      title: "Split",
      nodeId: w.open.id,
    });
    expect(split.completed).toBe(true);
    // The id of the removed thread, and the older date of the post it was made from.
    expect(split.thread.id).toBe(x.thread.id);
    await w.call("threads.delete", w.mod, { threadId: split.thread.id });
    await w.call("threads.restore", w.mod, { threadId: split.thread.id });
    expect(
      w.ctx.sqlite
        .prepare<{ state: string }, [number]>("SELECT state FROM threads WHERE id = ?1")
        .get(split.thread.id),
    ).toEqual({ state: "visible" });
  });

  test("a wall post with more than 500 comments cannot be restored by any route until it is gone", async () => {
    const w = world();
    const post = await w.wall(w.alice, w.bobUser.id, "Busy wall");
    const insert = w.ctx.sqlite.prepare(
      "INSERT INTO profile_post_comments (profile_post_id, user_id, state, created_at, body_source, body_html) VALUES (?1, ?2, 'visible', 1, 'c', '<p>c</p>')",
    );
    for (let i = 0; i < 520; i++) insert.run(post.id, w.carolUser.id);
    await w.call("profilePosts.delete", w.admin, { profilePostId: post.id });
    // Before it begins, restoring is allowed (and undone again here).
    await w.call("profilePosts.restore", w.mod, { profilePostId: post.id });
    await w.call("profilePosts.delete", w.admin, { profilePostId: post.id });
    expect(
      await w.call("profilePosts.hardDelete", w.admin, { profilePostId: post.id }),
    ).toMatchObject({ completed: false });
    const refused = /being deleted for good/;
    await expect(w.call("profilePosts.restore", w.mod, { profilePostId: post.id })).rejects.toThrow(
      refused,
    );
    await expect(
      w.call("moderation.setState", w.admin, {
        target: { type: "profile_post", id: post.id },
        state: "visible",
      }),
    ).rejects.toThrow(refused);
    await expect(
      w.call("moderation.bulk", w.admin, {
        targets: [{ type: "profile_post", id: post.id }],
        action: "restore",
      }),
    ).rejects.toThrow(refused);
    expect(
      w.ctx.sqlite
        .prepare<{ state: string }, [number]>("SELECT state FROM profile_posts WHERE id = ?1")
        .get(post.id),
    ).toEqual({ state: "deleted" });
    expect(
      await w.call("profilePosts.hardDelete", w.admin, { profilePostId: post.id }),
    ).toMatchObject({ completed: true });
  });
});

describe("the unread counters of members who held alerts on removed content", () => {
  test("two unread alerts take two off, a read alert nothing, and no counter goes below 0", async () => {
    const w = world();
    const t = await w.thread(w.alice, w.open.id, "T");
    const reply = await w.reply(w.bob, t.thread.id, "R");
    const [two, short, none] = [insertUser(w.ctx).id, insertUser(w.ctx).id, insertUser(w.ctx).id];
    const sql = w.ctx.sqlite;
    const alert = sql.prepare(
      "INSERT INTO notifications (user_id, epoch, type, content_type, content_id, thread_id, created_at, updated_at, read_at) VALUES (?1, 0, ?2, 'post', ?3, ?4, 1, 1, ?5)",
    );
    // Two unread alerts of different types and a read one for the first member.
    alert.run(two, "content.quoted", reply.id, t.thread.id, null);
    alert.run(two, "content.mentioned", reply.id, t.thread.id, null);
    alert.run(two, "thread.watched", reply.id, t.thread.id, 9);
    // Counters that are lower than what is removed.
    alert.run(short, "content.quoted", reply.id, t.thread.id, null);
    alert.run(short, "content.mentioned", reply.id, t.thread.id, null);
    alert.run(none, "content.quoted", reply.id, t.thread.id, null);
    const setCounter = sql.prepare("UPDATE users SET unread_notification_count = ?1 WHERE id = ?2");
    setCounter.run(5, two);
    setCounter.run(1, short);
    setCounter.run(0, none);
    await w.call("posts.delete", w.bob, { postId: reply.id });
    await w.call("posts.hardDelete", w.admin, { postId: reply.id });
    expect([two, short, none].map((id) => user(w, id).unread_notification_count)).toEqual([
      3, 0, 0,
    ]);
  });
});
