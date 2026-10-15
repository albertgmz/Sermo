import { describe, expect, test } from "bun:test";
import { actorUserId, GUEST } from "../../actor";
import { ConflictError, ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { dispatchEvents } from "../../events";
import { registerCreditRuleJobs } from "../credit-events";
import { fillPosts, type World, world } from "../feed/fixtures.test";

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
    reports:
      one("SELECT count(*) AS n FROM report_groups", threadId) +
      one("SELECT count(*) AS n FROM reports"),
    alerts: one(
      "SELECT count(*) AS n FROM notifications WHERE thread_id = ?1 OR (content_type = 'post' AND content_id IN (SELECT value FROM json_each(?2)))",
      threadId,
      posts,
    ),
    quotes: one("SELECT count(*) AS n FROM content_quotes"),
    mentions: one("SELECT count(*) AS n FROM content_mentions"),
    credits: one("SELECT count(*) AS n FROM credit_rule_applications"),
    attachments: one("SELECT count(*) AS n FROM attachments"),
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
