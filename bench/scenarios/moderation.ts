import type { Scenario } from "../harness";

/** The group the warning actions below add members to; removed again by the teardown. */
let warningGroupId = 0;

export const scenarios: Scenario[] = [
  {
    // Four automatic actions are configured: a timed group at 1 point and a restriction at 2
    // fire for most seeded members, a ban and a second group are out of reach.
    name: "moderation.warnings.create with actions",
    kind: "write",
    iterations: 50,
    setup(env) {
      const db = env.ctx.sqlite;
      warningGroupId = db
        .prepare<{ id: number }, []>(
          "INSERT INTO groups (title, rank) VALUES ('Benchmark probation', 1) RETURNING id",
        )
        .get()!.id;
      const insert = db.prepare(
        "INSERT INTO warning_actions (threshold, kind, days, group_id, restriction_kind, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
      );
      const now = env.ctx.now();
      insert.run(1, "group", 7, warningGroupId, null, now);
      insert.run(2, "restriction", 7, null, "profile_posts", now);
      insert.run(1_000_000, "ban", 7, null, null, now);
      insert.run(1_000_001, "group", null, warningGroupId, null, now);
    },
    run: (env, i) =>
      env.call("warnings.create", env.actors.admin, {
        userId: env.meta.memberIds[(i + 100) % env.meta.memberIds.length]!,
        points: 1,
        reason: "Benchmark warning",
        notify: false,
      }),
    teardown(env) {
      const db = env.ctx.sqlite;
      db.prepare(
        "UPDATE users SET restricted_profile_posts_until = NULL WHERE id IN (SELECT user_id FROM warnings WHERE reason = 'Benchmark warning')",
      ).run();
      db.prepare("DELETE FROM user_restrictions WHERE reason LIKE 'Warning threshold:%'").run();
      db.prepare("DELETE FROM user_groups WHERE group_id = ?1").run(warningGroupId);
      db.run("DELETE FROM warning_action_fires");
      db.run("DELETE FROM warning_actions");
      db.prepare("DELETE FROM groups WHERE id = ?1").run(warningGroupId);
      db.prepare("DELETE FROM warnings WHERE reason = 'Benchmark warning'").run();
    },
  },
  {
    name: "moderation.restrictions.create",
    kind: "write",
    iterations: 50,
    run: (env, i) =>
      env.call("restrictions.create", env.actors.admin, {
        userId: env.meta.memberIds[i % env.meta.memberIds.length]!,
        kind: "posting",
        reason: "Benchmark restriction",
        notify: false,
      }),
  },
  {
    name: "moderation.reportQueue20k",
    kind: "read",
    setup: (env) => {
      env.ctx.sqlite.run("UPDATE report_groups SET state = 'open'");
    },
    run: (env) => env.call("reports.list", env.actors.admin, { state: "open", limit: 50 }),
  },
  {
    name: "moderation.hugeThreadState",
    kind: "write",
    iterations: 30,
    run: (env) => {
      const threadId = env.meta.bigThreadIds[0]!;
      const state = env.ctx.sqlite
        .prepare<{ state: string }, [number]>("SELECT state FROM threads WHERE id = ?1")
        .get(threadId)!.state;
      return env.call("moderation.setState", env.actors.admin, {
        target: { type: "thread", id: threadId },
        state: state === "visible" ? "deleted" : "visible",
      });
    },
  },
  {
    name: "moderation.log",
    kind: "read",
    run: (env) => env.call("moderatorLog.list", env.actors.admin, { limit: 50 }),
  },
  {
    name: "moderation.nodeReportQueue",
    kind: "read",
    setup: (env) => {
      env.ctx.sqlite.run("UPDATE report_groups SET state = 'open'");
      env.ctx.sqlite.run(
        "UPDATE report_groups SET node_id = (SELECT t.node_id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id = report_groups.target_id) WHERE target_type = 'post'",
      );
    },
    run: (env) =>
      env.call("reports.list", env.actors.admin, {
        state: "open",
        nodeId: env.meta.bigForumIds[0],
        limit: 50,
      }),
  },
  {
    name: "moderation.approvalQueue",
    kind: "read",
    run: (env) => env.call("approvals.list", env.actors.admin, { limit: 50 }),
  },
  {
    name: "moderation.nodeApprovalQueue",
    kind: "read",
    run: (env) =>
      env.call("approvals.list", env.actors.admin, { nodeId: env.meta.bigForumIds[0], limit: 50 }),
  },
  {
    name: "moderation.reportQueue no permissions",
    kind: "read",
    setup: (env) => env.ctx.sqlite.run("UPDATE report_groups SET state = 'open'"),
    run: (env) => env.call("reports.list", env.actors.member(0), { state: "open", limit: 50 }),
  },
  {
    name: "moderation.reportQueue single node",
    kind: "read",
    async setup(env) {
      env.ctx.sqlite.run("UPDATE report_groups SET state = 'open'");
      env.ctx.sqlite.run(
        "UPDATE report_groups SET node_id = (SELECT t.node_id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id = report_groups.target_id) WHERE target_type = 'post'",
      );
      // In-process: an API key may not run this operation, and a session needs the password.
      await env.callInProcess("nodes.setModerator", env.actors.admin, {
        nodeId: env.meta.bigForumIds[0],
        userId: env.meta.memberIds[0],
      });
    },
    run: (env) => env.call("reports.list", env.actors.member(0), { state: "open", limit: 50 }),
  },
  {
    name: "moderation.threadBanCreate",
    kind: "write",
    iterations: 10,
    run: (env, i) =>
      env.call("threadBans.create", env.actors.moderator(0), {
        threadId: env.meta.bigThreadIds[0],
        userId: env.meta.memberIds[i],
        reason: "Benchmark",
      }),
  },
];
