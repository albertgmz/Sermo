import { describe, expect, test } from "bun:test";
import {
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { invalidate } from "../../context";
import { writeTx } from "../../db/tx";
import { ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { dispatchEvents, publishEvent } from "../../events";
import { execute } from "../../operation";
import { forumSql, postsCreateOp, threadsCreateOp, threadsMarkReadOp } from "../forums";
import { runDueJobs } from "../jobs";
import { runHourlyTasks } from "../jobs/scheduler";
import { readSiteSettings, updateSiteSettings } from "../settings";
import {
  announcementsCreateOp,
  listSql,
  listUnreadSql,
  notificationsListOp,
  notificationsMarkReadOp,
  notificationsPreferencesOp,
  notificationsSetPreferencesOp,
  notificationsTypesOp,
  registerNotificationJobs,
} from "./index";

async function drain(ctx: ReturnType<typeof createTestContext>) {
  await dispatchEvents(ctx);
  await runDueJobs(ctx);
}

describe("notifications", () => {
  test("watched replies fan out once, clear on thread read, and obey preferences", async () => {
    const ctx = createTestContext();
    registerNotificationJobs(ctx);
    const author = insertUser(ctx);
    const watcher = insertUser(ctx);
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const thread = await execute(ctx, threadsCreateOp, userActor(author), {
      nodeId: node.id,
      title: "Topic",
      body: "First",
    });
    ctx.sqlite
      .prepare("INSERT INTO thread_watches (user_id, thread_id, created_at) VALUES (?1, ?2, ?3)")
      .run(watcher.id, thread.thread.id, ctx.now());
    await drain(ctx);
    const reply = await execute(ctx, postsCreateOp, userActor(author), {
      threadId: thread.thread.id,
      body: "Reply",
    });
    await drain(ctx);
    const page = await execute(ctx, notificationsListOp, userActor(watcher), { limit: 10 });
    expect(page.items.map((item) => item.type)).toEqual(["thread.watched"]);
    expect(page.unreadCount).toBe(1);
    await drain(ctx);
    expect(
      (await execute(ctx, notificationsListOp, userActor(watcher), { limit: 10 })).items,
    ).toHaveLength(1);
    await execute(ctx, threadsMarkReadOp, userActor(watcher), {
      threadId: thread.thread.id,
      position: reply.position,
    });
    expect(
      (await execute(ctx, notificationsListOp, userActor(watcher), { unreadOnly: true, limit: 10 }))
        .unreadCount,
    ).toBe(0);
    await execute(ctx, notificationsSetPreferencesOp, userActor(watcher), {
      items: [{ type: "thread.watched", inApp: false }],
    });
    await execute(ctx, postsCreateOp, userActor(author), {
      threadId: thread.thread.id,
      body: "Again",
    });
    await drain(ctx);
    expect(
      (await execute(ctx, notificationsListOp, userActor(watcher), { unreadOnly: true, limit: 10 }))
        .items,
    ).toHaveLength(0);
  });

  test("own read state, type catalog, preferences and announcements require permissions", async () => {
    const ctx = createTestContext();
    registerNotificationJobs(ctx);
    const member = insertUser(ctx);
    const admin = insertUser(ctx, { groupId: 4 });
    await expect(execute(ctx, notificationsListOp, GUEST, { limit: 10 })).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(
      execute(ctx, notificationsMarkReadOp, GUEST, { all: true }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(
      execute(ctx, announcementsCreateOp, userActor(member), { title: "Hello", body: "World" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      execute(ctx, notificationsSetPreferencesOp, userActor(member), {
        items: [{ type: "account.security", email: false }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(
      (await execute(ctx, notificationsTypesOp, userActor(member), {})).items.length,
    ).toBeGreaterThan(10);
    expect(
      (await execute(ctx, notificationsPreferencesOp, userActor(member), {})).items.length,
    ).toBeGreaterThan(10);
    const announcement = await execute(ctx, announcementsCreateOp, userActor(admin), {
      title: "Hello",
      body: "World",
    });
    expect(announcement.id).toBeGreaterThan(0);
    await drain(ctx);
    const listing = await execute(ctx, notificationsListOp, userActor(member), { limit: 10 });
    expect(listing.items[0]?.type).toBe("announcement");
    expect(listing.unreadCount).toBe(1);
    expect(
      (
        await execute(ctx, notificationsMarkReadOp, userActor(member), {
          ids: [listing.items[0]!.id],
        })
      ).unreadCount,
    ).toBe(0);
    expect(
      (await execute(ctx, notificationsListOp, userActor(admin), { limit: 10 })).items,
    ).toEqual([]);
  });

  test("mentions outrank quotes and watches; reactions require visible content", async () => {
    const ctx = createTestContext();
    registerNotificationJobs(ctx);
    const author = insertUser(ctx);
    const recipient = insertUser(ctx);
    const node = insertNode(ctx, {});
    invalidate(ctx, "node_tree");
    const thread = await execute(ctx, threadsCreateOp, userActor(author), {
      nodeId: node.id,
      title: "References",
      body: "First",
    });
    await drain(ctx);
    ctx.sqlite
      .prepare("INSERT INTO thread_watches (user_id, thread_id, created_at) VALUES (?1, ?2, ?3)")
      .run(recipient.id, thread.thread.id, ctx.now());
    const reply = await execute(ctx, postsCreateOp, userActor(author), {
      threadId: thread.thread.id,
      body: "Reply",
    });
    ctx.sqlite
      .prepare(
        "INSERT INTO content_mentions (content_type, content_id, user_id, created_at) VALUES ('post', ?1, ?2, ?3)",
      )
      .run(reply.id, recipient.id, ctx.now());
    ctx.sqlite
      .prepare(
        "INSERT INTO content_quotes (content_type, content_id, quoted_post_id, quoted_user_id, created_at) VALUES ('post', ?1, ?2, ?3, ?4)",
      )
      .run(reply.id, thread.post.id, recipient.id, ctx.now());
    await drain(ctx);
    const listing = await execute(ctx, notificationsListOp, userActor(recipient), { limit: 10 });
    expect(listing.items.map((item) => item.type)).toEqual(["content.mentioned"]);
    writeTx(ctx, () =>
      publishEvent(ctx, {
        type: "reaction.added",
        targetType: "post",
        targetId: reply.id,
        payload: { userId: recipient.id, contentUserId: author.id, reactionTypeId: 1 },
      }),
    );
    await drain(ctx);
    expect(
      (await execute(ctx, notificationsListOp, userActor(author), { limit: 10 })).items[0]?.type,
    ).toBe("content.reaction");
    ctx.sqlite.prepare("UPDATE posts SET state = 'deleted' WHERE id = ?1").run(reply.id);
    writeTx(ctx, () =>
      publishEvent(ctx, {
        type: "reaction.added",
        targetType: "post",
        targetId: reply.id,
        payload: { userId: recipient.id, contentUserId: author.id, reactionTypeId: 1 },
      }),
    );
    await drain(ctx);
    expect(
      (await execute(ctx, notificationsListOp, userActor(author), { limit: 10 })).items,
    ).toHaveLength(1);
  });

  test("list and fan-out source queries use indexed keysets", () => {
    const ctx = createTestContext();
    expectNoTableScan(ctx, listSql, [1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 21]);
    expectNoTableScan(ctx, listUnreadSql, [
      1,
      0,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
      21,
    ]);
    expectNoTableScan(
      ctx,
      "SELECT user_id FROM thread_watches WHERE thread_id = ?1 AND user_id > ?2 ORDER BY user_id LIMIT ?3",
      [1, 0, 100],
    );
    expectNoTableScan(
      ctx,
      "SELECT user_id FROM node_watches WHERE node_id = ?1 AND mode = 'posts' AND user_id > ?2 ORDER BY user_id LIMIT ?3",
      [1, 0, 100],
    );
    expectNoTableScan(
      ctx,
      "SELECT user_id FROM user_follows WHERE followed_id = ?1 AND user_id > ?2 ORDER BY user_id LIMIT ?3",
      [1, 0, 100],
    );
    expectNoTableScan(
      ctx,
      "SELECT id AS user_id FROM users WHERE permission_combination_id = ?1 AND id > ?2 ORDER BY id LIMIT ?3",
      [1, 0, 40],
    );
    expectNoTableScan(
      ctx,
      "SELECT user_id FROM thread_reads WHERE thread_id = ?1 AND last_read_post_id >= ?2 AND user_id IN (SELECT value FROM json_each(?3))",
      [1, 0, "[1,2]"],
    );
    expectNoTableScan(
      ctx,
      "SELECT DISTINCT quoted_user_id AS user_id FROM content_quotes WHERE content_type = ?1 AND content_id = ?4 AND quoted_user_id > ?2 ORDER BY quoted_user_id LIMIT ?3",
      ["post", 0, 100, 1],
    );
    expectNoTableScan(
      ctx,
      "SELECT DISTINCT user_id FROM profile_post_comments WHERE profile_post_id = ?1 AND user_id > ?2 ORDER BY user_id LIMIT ?3",
      [1, 0, 100],
    );
    expectNoTableScan(
      ctx,
      "SELECT epoch FROM notifications WHERE user_id = ?1 AND epoch < ?2 AND read_at IS NULL ORDER BY epoch LIMIT 1",
      [1, 1],
    );
    expectNoTableScan(
      ctx,
      "SELECT id FROM notifications WHERE user_id = ?1 AND epoch = ?2 AND read_at IS NULL ORDER BY updated_at, id LIMIT 100",
      [1, 0],
    );
    const openGroups =
      "SELECT n.id, n.user_id, n.last_event_id, n.actor_ids, n.data FROM json_each(?2) AS j CROSS JOIN users u ON u.id = j.value CROSS JOIN notifications n INDEXED BY notifications_user_group ON n.user_id = u.id AND n.epoch = u.notification_epoch AND n.group_key = ?1 AND n.read_at IS NULL";
    expectNoTableScan(ctx, openGroups, ["thread:1", "[1,2]"]);
    expect(
      ctx.sqlite
        .prepare<{ detail: string }, [string, string]>(`EXPLAIN QUERY PLAN ${openGroups}`)
        .all("thread:1", "[1,2]")
        .map((row) => row.detail),
    ).toEqual([
      "SCAN j VIRTUAL TABLE INDEX 1:",
      "SEARCH u USING INTEGER PRIMARY KEY (rowid=?)",
      "SEARCH n USING INDEX notifications_user_group (user_id=? AND epoch=? AND group_key=?)",
    ]);
    expectNoTableScan(
      ctx,
      "SELECT user_id FROM notifications INDEXED BY notifications_user_recent WHERE user_id IN (SELECT value FROM json_each(?1)) AND updated_at >= ?2 AND group_key = ?3 AND last_event_id >= ?4",
      ["[1,2]", 0, "thread:1", 1],
    );
    expectNoTableScan(
      ctx,
      "SELECT id FROM notifications WHERE read_at IS NOT NULL AND read_at < ?1 ORDER BY read_at, id LIMIT 40",
      [ctx.now()],
    );
    expectNoTableScan(ctx, forumSql.clearThreadNotices, [ctx.now(), 1, 1, 1]);
    expect(
      ctx.sqlite
        .prepare<{ detail: string }, [number, number, number, number]>(
          `EXPLAIN QUERY PLAN ${forumSql.clearThreadNotices}`,
        )
        .all(ctx.now(), 1, 1, 1)
        .map((row) => row.detail),
    ).toContain(
      "SEARCH notifications USING INDEX notifications_user_thread (user_id=? AND thread_id=?)",
    );
    expectNoTableScan(
      ctx,
      "SELECT id, type, payload FROM domain_events WHERE target_type = ?1 AND target_id = ?2 AND id < ?3 AND type IN (SELECT value FROM json_each(?4)) ORDER BY id",
      ["post", 1, 100, '["content.edited"]'],
    );
    expectNoTableScan(
      ctx,
      "SELECT user_id FROM content_mentions WHERE content_type = ?1 AND content_id = ?2 AND user_id IN (SELECT value FROM json_each(?3)) AND user_id NOT IN (SELECT user_id FROM notifications WHERE content_type = ?1 AND content_id = ?2 AND type = 'content.mentioned' AND last_event_id > ?4)",
      ["post", 1, "[1,2]", 1],
    );
    const plan = (sql: string, params: (string | number)[]) =>
      ctx.sqlite
        .prepare<{ detail: string }, (string | number)[]>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...params)
        .map((row) => row.detail);
    // Per-batch lookups seek by member or resume after the last notification id, so a fan-out
    // or clean-up never re-reads every notice of a hot post in each batch.
    const delivered =
      "SELECT user_id FROM notifications INDEXED BY notifications_user_recent WHERE user_id IN (SELECT value FROM json_each(?1)) AND updated_at >= ?2 AND last_event_id = ?3 AND content_type = ?4 AND content_id = ?5";
    expectNoTableScan(ctx, delivered, ["[1,2]", 0, 1, "post", 1]);
    expect(plan(delivered, ["[1,2]", 0, 1, "post", 1])).toContain(
      "SEARCH notifications USING INDEX notifications_user_recent (user_id=? AND updated_at>?)",
    );
    const unreadOfType =
      "SELECT n.id, n.user_id, n.epoch, u.notification_epoch AS current_epoch FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.content_type = ?1 AND n.content_id = ?2 AND n.id > ?5 AND n.type = ?3 AND n.read_at IS NULL AND n.last_event_id < ?4 ORDER BY n.id LIMIT 40";
    expectNoTableScan(ctx, unreadOfType, ["report_group", 1, "moderator.report", 10, 0]);
    expect(plan(unreadOfType, ["report_group", 1, "moderator.report", 10, 0])).toContain(
      "SEARCH n USING INDEX notifications_content (content_type=? AND content_id=? AND rowid>?)",
    );
    const unreadForContent =
      "SELECT n.id, n.user_id, n.epoch, u.notification_epoch AS current_epoch, n.type, n.data, n.thread_id, n.content_id, n.actor_ids FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.content_type = ?1 AND n.content_id = ?2 AND n.id > ?4 AND n.read_at IS NULL AND n.last_event_id < ?3 ORDER BY n.id LIMIT 40";
    expectNoTableScan(ctx, unreadForContent, ["post", 1, 10, 0]);
    expect(plan(unreadForContent, ["post", 1, 10, 0])).toContain(
      "SEARCH n USING INDEX notifications_content (content_type=? AND content_id=? AND rowid>?)",
    );
    expectNoTableScan(
      ctx,
      "SELECT id, user_id FROM posts WHERE thread_id = ?1 AND position >= (SELECT position FROM posts WHERE id = ?2) AND position < (SELECT position FROM posts WHERE id = ?3) AND id < ?3 AND id > coalesce((SELECT last_read_post_id FROM thread_reads WHERE user_id = ?4 AND thread_id = ?1), 0) AND state = 'visible' AND user_id != ?4 ORDER BY position DESC LIMIT 1",
      [1, 1, 10, 1],
    );
  });

  test("mark all advances an epoch, keeps older rows logically read, and permits a fresh group", async () => {
    const ctx = createTestContext();
    registerNotificationJobs(ctx);
    const user = insertUser(ctx);
    const actor = userActor(user);
    const old = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO notifications (user_id, type, content_type, content_id, group_key, created_at, updated_at) VALUES (?1, 'thread.watched', 'thread', 42, 'thread:42', ?2, ?2)",
        )
        .run(user.id, ctx.now()).lastInsertRowid,
    );
    ctx.sqlite.prepare("UPDATE users SET unread_notification_count = 1 WHERE id = ?1").run(user.id);
    expect((await execute(ctx, notificationsMarkReadOp, actor, { all: true })).unreadCount).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ notification_epoch: number }, [number]>(
          "SELECT notification_epoch FROM users WHERE id = ?1",
        )
        .get(user.id)?.notification_epoch,
    ).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ read_at: number | null }, [number]>(
          "SELECT read_at FROM notifications WHERE id = ?1",
        )
        .get(old)?.read_at,
    ).toBeNull();
    expect((await execute(ctx, notificationsListOp, actor, { limit: 10 })).items[0]?.read).toBe(
      true,
    );
    expect(
      (await execute(ctx, notificationsListOp, actor, { unreadOnly: true, limit: 10 })).items,
    ).toHaveLength(0);
    ctx.sqlite
      .prepare(
        "INSERT INTO notifications (user_id, epoch, type, content_type, content_id, group_key, created_at, updated_at) VALUES (?1, 1, 'thread.watched', 'thread', 42, 'thread:42', ?2, ?2)",
      )
      .run(user.id, ctx.now());
    ctx.sqlite.prepare("UPDATE users SET unread_notification_count = 1 WHERE id = ?1").run(user.id);
    expect(
      (await execute(ctx, notificationsListOp, actor, { unreadOnly: true, limit: 10 })).items,
    ).toHaveLength(1);
    await runDueJobs(ctx);
    expect(
      ctx.sqlite
        .prepare<{ read_at: number | null }, [number]>(
          "SELECT read_at FROM notifications WHERE id = ?1",
        )
        .get(old)?.read_at,
    ).not.toBeNull();
    expect((await execute(ctx, notificationsListOp, actor, { limit: 10 })).unreadCount).toBe(1);
  });

  test("marking ids never changes another member's or an older epoch's count", async () => {
    const ctx = createTestContext();
    registerNotificationJobs(ctx);
    const one = insertUser(ctx);
    const two = insertUser(ctx);
    const insert = ctx.sqlite.prepare(
      "INSERT INTO notifications (user_id, type, content_type, content_id, created_at, updated_at) VALUES (?1, 'member.followed', 'user', ?2, ?3, ?3)",
    );
    const first = Number(insert.run(one.id, one.id, ctx.now()).lastInsertRowid);
    const second = Number(insert.run(two.id, two.id, ctx.now()).lastInsertRowid);
    ctx.sqlite
      .prepare("UPDATE users SET unread_notification_count = 1 WHERE id IN (?1, ?2)")
      .run(one.id, two.id);
    expect(
      (await execute(ctx, notificationsMarkReadOp, userActor(one), { ids: [first, second] }))
        .unreadCount,
    ).toBe(0);
    expect(
      (await execute(ctx, notificationsListOp, userActor(two), { unreadOnly: true, limit: 10 }))
        .unreadCount,
    ).toBe(1);
    await execute(ctx, notificationsMarkReadOp, userActor(two), { all: true });
    expect(
      (await execute(ctx, notificationsMarkReadOp, userActor(two), { ids: [second] })).unreadCount,
    ).toBe(0);
  });
  test("stamping resumes across batches and every older epoch", async () => {
    const ctx = createTestContext();
    registerNotificationJobs(ctx);
    const user = insertUser(ctx);
    for (const epoch of [0, 1]) {
      ctx.sqlite
        .prepare(
          "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 120) INSERT INTO notifications (user_id, epoch, type, content_type, content_id, created_at, updated_at) SELECT ?1, ?2, 'member.followed', 'user', ?1, ?3, ?3 FROM seq",
        )
        .run(user.id, epoch, ctx.now());
      ctx.sqlite
        .prepare("UPDATE users SET unread_notification_count = 120 WHERE id = ?1")
        .run(user.id);
      await execute(ctx, notificationsMarkReadOp, userActor(user), { all: true });
    }
    await runDueJobs(ctx);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM notifications WHERE user_id = ?1 AND read_at IS NULL",
        )
        .get(user.id)?.n,
    ).toBe(0);
    expect(
      (await execute(ctx, notificationsListOp, userActor(user), { limit: 1 })).unreadCount,
    ).toBe(0);
  });

  test("preferences resolve admin defaults, reset channels, and retention purges read rows", async () => {
    const ctx = createTestContext();
    registerNotificationJobs(ctx);
    const member = insertUser(ctx);
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    const settings = readSiteSettings(ctx);
    updateSiteSettings(ctx, admin, {
      ...settings,
      notificationDefaults: { "thread.watched": { inApp: false, email: true, push: false } },
    });
    const before = await execute(ctx, notificationsPreferencesOp, userActor(member), {});
    expect(before.items.find((item) => item.type === "thread.watched")).toMatchObject({
      inApp: false,
      email: true,
    });
    await execute(ctx, notificationsSetPreferencesOp, userActor(member), {
      items: [{ type: "thread.watched", inApp: true }],
    });
    expect(
      (await execute(ctx, notificationsPreferencesOp, userActor(member), {})).items.find(
        (item) => item.type === "thread.watched",
      )?.inApp,
    ).toBe(true);
    await execute(ctx, notificationsSetPreferencesOp, userActor(member), {
      items: [{ type: "thread.watched", inApp: null }],
    });
    expect(
      (await execute(ctx, notificationsPreferencesOp, userActor(member), {})).items.find(
        (item) => item.type === "thread.watched",
      )?.inApp,
    ).toBe(false);
    const id = Number(
      ctx.sqlite
        .prepare(
          "INSERT INTO notifications (user_id, type, content_type, content_id, created_at, updated_at) VALUES (?1, 'member.followed', 'user', ?1, ?2, ?2)",
        )
        .run(member.id, ctx.now()).lastInsertRowid,
    );
    ctx.sqlite
      .prepare("UPDATE users SET unread_notification_count = 1 WHERE id = ?1")
      .run(member.id);
    await execute(ctx, notificationsMarkReadOp, userActor(member), { ids: [id] });
    ctx.sqlite
      .prepare(
        "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 120) INSERT INTO notifications (user_id, type, content_type, content_id, created_at, updated_at, read_at) SELECT ?1, 'member.followed', 'user', ?1, ?2, ?2, ?2 FROM seq",
      )
      .run(member.id, ctx.now());
    ctx.clock.advance(91 * 86_400_000);
    runHourlyTasks(ctx);
    await runDueJobs(ctx);
    expect(
      ctx.sqlite
        .prepare<{ id: number }, [number]>("SELECT id FROM notifications WHERE id = ?1")
        .get(id),
    ).toBeNull();
    expect(
      ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM notifications WHERE user_id = ?1 AND read_at IS NOT NULL",
        )
        .get(member.id)?.n,
    ).toBe(0);
  });
});
