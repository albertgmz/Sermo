import { dispatchEvents, encodeCursor, registerNotificationJobs, runDueJobs } from "@sermo/core";
import type { BenchEnv, Scenario } from "../harness";

let heavy = 0;
let deepCursor = "";
let hotAuthor = 0;
let background: Promise<void> | null = null;
let markAllUsers: number[] = [];
let fanoutStart = 0;
let fanoutEnd = 0;
let fanoutEventId = 0;
let expectedRecipients = 0;

function author(env: BenchEnv, threadId: number): number {
  return env.ctx.sqlite
    .prepare<{ user_id: number }, [number]>("SELECT user_id FROM threads WHERE id = ?1")
    .get(threadId)!.user_id;
}

async function drain(env: BenchEnv): Promise<void> {
  for (let i = 0; i < 10_000; i++) {
    const latest =
      env.ctx.sqlite
        .prepare<{ id: number }, []>("SELECT id FROM domain_events ORDER BY id DESC LIMIT 1")
        .get()?.id ?? 0;
    const cursor =
      env.ctx.sqlite
        .prepare<{ last_event_id: number }, []>(
          "SELECT last_event_id FROM event_subscribers WHERE name = 'notifications'",
        )
        .get()?.last_event_id ?? 0;
    const pending = env.ctx.sqlite
      .prepare<{ id: number }, []>(
        "SELECT id FROM jobs WHERE type LIKE 'notifications.%' AND status IN ('pending', 'running') LIMIT 1",
      )
      .get();
    if (cursor >= latest && !pending) return;
    const handled = await dispatchEvents(env.ctx);
    const ran = await runDueJobs(env.ctx, { limit: 10 });
    if (handled === 0 && ran === 0) throw new Error("Notification jobs did not complete.");
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error("Notification fan-out did not drain.");
}

export const scenarios: Scenario[] = [
  {
    name: "notifications.list heavy first page",
    kind: "read",
    setup(env) {
      heavy = env.meta.notificationHeavyUserIds[0]!;
    },
    run(env) {
      return env.call("notifications.list", env.actors.user(heavy), { limit: 20 });
    },
  },
  {
    name: "notifications.list heavy deep page",
    kind: "read",
    setup(env) {
      heavy = env.meta.notificationHeavyUserIds[0]!;
      const rows = env.ctx.sqlite
        .prepare<{ updated_at: number; id: number }, [number]>(
          "SELECT updated_at, id FROM notifications WHERE user_id = ?1 ORDER BY updated_at DESC, id DESC LIMIT 1000",
        )
        .all(heavy);
      const row = rows.at(-1)!;
      deepCursor = encodeCursor([row.updated_at, row.id]);
    },
    run(env) {
      return env.call("notifications.list", env.actors.user(heavy), {
        cursor: deepCursor,
        limit: 20,
      });
    },
  },
  {
    name: "notifications.markRead one",
    kind: "write",
    run(env) {
      const id = env.meta.notificationHeavyUserIds[0]!;
      const row = env.ctx.sqlite
        .prepare<{ id: number }, [number]>(
          "SELECT id FROM notifications WHERE user_id = ?1 AND epoch = (SELECT notification_epoch FROM users WHERE id = ?1) AND read_at IS NULL ORDER BY id LIMIT 1",
        )
        .get(id);
      if (!row) throw new Error("Mark-one needs an unread notification.");
      return env.call("notifications.markRead", env.actors.user(id), { ids: [row.id] });
    },
  },
  {
    name: "notifications.markRead all",
    kind: "write",
    iterations: 50,
    setup(env) {
      markAllUsers = env.ctx.sqlite
        .prepare<{ user_id: number }, []>(
          "SELECT n.user_id FROM notifications n JOIN users u ON u.id = n.user_id WHERE n.read_at IS NULL AND n.epoch = u.notification_epoch GROUP BY n.user_id ORDER BY n.user_id LIMIT 60",
        )
        .all()
        .map((row) => row.user_id);
      if (markAllUsers.length < 60)
        throw new Error("Mark-all needs 60 users with unread notifications.");
    },
    run(env, i) {
      const id = markAllUsers[i]!;
      return env.call("notifications.markRead", env.actors.user(id), { all: true });
    },
  },
  {
    name: "notifications.setPreferences",
    kind: "write",
    run(env) {
      const id = env.meta.notificationHeavyUserIds[0]!;
      const current = env.ctx.sqlite
        .prepare<{ in_app: number | null }, [number]>(
          "SELECT in_app FROM notification_preferences WHERE user_id = ?1 AND type = 'thread.watched'",
        )
        .get(id);
      return env.call("notifications.setPreferences", env.actors.user(id), {
        items: [{ type: "thread.watched", inApp: current?.in_app !== 1 }],
      });
    },
  },
  {
    name: "notifications.markOldRead stamping job",
    kind: "write",
    iterations: 1,
    budgetExempt: "notification fan-out",
    setup(env) {
      registerNotificationJobs(env.ctx);
      for (const id of markAllUsers.slice(0, 2)) {
        env.ctx.sqlite
          .prepare(
            "WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 1000) INSERT INTO notifications (user_id, epoch, type, content_type, content_id, created_at, updated_at) SELECT ?1, (SELECT notification_epoch FROM users WHERE id = ?1), 'member.followed', 'user', ?1, ?2, ?2 FROM seq",
          )
          .run(id, env.ctx.now());
        env.ctx.sqlite
          .prepare(
            "UPDATE users SET unread_notification_count = unread_notification_count + 1000 WHERE id = ?1",
          )
          .run(id);
      }
    },
    async run(env, i) {
      await env.call("notifications.markRead", env.actors.user(markAllUsers[i]!), { all: true });
      while (await runDueJobs(env.ctx, { limit: 10 }))
        await new Promise((resolve) => setImmediate(resolve));
    },
  },
  {
    name: "notifications.hot watched reply request",
    kind: "write",
    setup(env) {
      hotAuthor = author(env, env.meta.hotWatchedThreadId);
    },
    run(env, i) {
      return env.call("posts.create", env.actors.user(hotAuthor), {
        threadId: env.meta.hotWatchedThreadId,
        body: `Watched reply ${i}`,
      });
    },
  },
  {
    name: "notifications.fanout watched thread (20,000 recipients)",
    kind: "write",
    iterations: 1,
    budgetExempt: "notification fan-out",
    setup(env) {
      registerNotificationJobs(env.ctx);
      hotAuthor = author(env, env.meta.hotWatchedThreadId);
    },
    async run(env, i) {
      const post = JSON.parse(
        (await env.call("posts.create", env.actors.user(hotAuthor), {
          threadId: env.meta.hotWatchedThreadId,
          body: `Fanout reply ${i}`,
        })) as string,
      ) as { id: number };
      await drain(env);
      const count = env.ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM notifications WHERE type = 'thread.watched' AND last_event_id = (SELECT id FROM domain_events WHERE type = 'content.created' AND target_type = 'post' AND target_id = ?1 ORDER BY id DESC LIMIT 1)",
        )
        .get(post.id)!.n;
      expectedRecipients = env.ctx.sqlite
        .prepare<{ n: number }, [number, number, number, number]>(
          "SELECT count(*) AS n FROM thread_watches w JOIN users u ON u.id = w.user_id LEFT JOIN notification_preferences p ON p.user_id = w.user_id AND p.type = 'thread.watched' LEFT JOIN user_ignores ig ON ig.user_id = w.user_id AND ig.ignored_id = ?2 LEFT JOIN thread_reads r ON r.user_id = w.user_id AND r.thread_id = ?1 WHERE w.thread_id = ?1 AND w.user_id != ?2 AND u.banned_permanently = 0 AND (u.banned_until IS NULL OR u.banned_until <= ?4) AND COALESCE(p.in_app, 1) = 1 AND ig.user_id IS NULL AND COALESCE(r.last_read_position, -1) < ?3",
        )
        .get(
          env.meta.hotWatchedThreadId,
          hotAuthor,
          env.ctx.sqlite
            .prepare<{ position: number }, [number]>("SELECT position FROM posts WHERE id = ?1")
            .get(post.id)!.position,
          env.ctx.now(),
        )!.n;
      if (count !== expectedRecipients)
        throw new Error(
          `Watched-thread fan-out reached ${count} of ${expectedRecipients} members.`,
        );
    },
  },
  {
    name: "notifications.fanout watched node (50,000 recipients)",
    kind: "write",
    iterations: 1,
    budgetExempt: "notification fan-out",
    setup(env) {
      registerNotificationJobs(env.ctx);
    },
    async run(env, i) {
      const created = JSON.parse(
        (await env.call("threads.create", env.actors.admin, {
          nodeId: env.meta.hotWatchedNodeId,
          title: `Announcement thread ${i}`,
          body: "Hello",
        })) as string,
      ) as { thread: { id: number } };
      await drain(env);
      const count = env.ctx.sqlite
        .prepare<{ n: number }, [number]>(
          "SELECT count(*) AS n FROM notifications WHERE content_type = 'thread' AND content_id = ?1 AND type = 'node.thread'",
        )
        .get(created.thread.id)!.n;
      const adminId = (env.actors.admin as { userId: number }).userId;
      expectedRecipients = env.ctx.sqlite
        .prepare<{ n: number }, [number, number, number]>(
          "SELECT count(*) AS n FROM node_watches w JOIN users u ON u.id = w.user_id LEFT JOIN notification_preferences p ON p.user_id = w.user_id AND p.type = 'node.thread' WHERE w.node_id = ?1 AND w.user_id != ?2 AND u.banned_permanently = 0 AND (u.banned_until IS NULL OR u.banned_until <= ?3) AND COALESCE(p.in_app, 1) = 1",
        )
        .get(env.meta.hotWatchedNodeId, adminId, env.ctx.now())!.n;
      if (count !== expectedRecipients)
        throw new Error(`Watched-node fan-out reached ${count} of ${expectedRecipients} members.`);
    },
  },
  {
    name: "notifications.list during fanout",
    kind: "read",
    setup(env) {
      registerNotificationJobs(env.ctx);
      heavy = env.meta.notificationHeavyUserIds[0]!;
      fanoutStart = 0;
      fanoutEnd = 0;
      fanoutEventId = 0;
      background = (async () => {
        const post = JSON.parse(
          (await env.call(
            "posts.create",
            env.actors.user(author(env, env.meta.hotWatchedThreadId)),
            {
              threadId: env.meta.hotWatchedThreadId,
              body: "Background fanout",
            },
          )) as string,
        ) as { id: number };
        fanoutEventId = env.ctx.sqlite
          .prepare<{ id: number }, [number]>(
            "SELECT id FROM domain_events WHERE type = 'content.created' AND target_type = 'post' AND target_id = ?1 ORDER BY id DESC LIMIT 1",
          )
          .get(post.id)!.id;
        await drain(env);
      })();
    },
    async run(env, i) {
      await new Promise((resolve) => setImmediate(resolve));
      const response = await env.call("notifications.list", env.actors.user(heavy), { limit: 20 });
      if ((i === 0 || i === 199) && fanoutEventId) {
        const count = env.ctx.sqlite
          .prepare<{ n: number }, [number]>(
            "SELECT count(*) AS n FROM notifications WHERE last_event_id = ?1",
          )
          .get(fanoutEventId)!.n;
        if (i === 0) fanoutStart = count;
        else fanoutEnd = count;
      }
      return response;
    },
    async teardown() {
      await background;
      if (fanoutEnd <= fanoutStart)
        throw new Error("Fan-out did not progress during measured reads.");
      background = null;
    },
  },
];
