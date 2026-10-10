import type { Scenario } from "../harness";

export const scenarios: Scenario[] = [
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
      await env.call("nodes.setModerator", env.actors.admin, {
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
