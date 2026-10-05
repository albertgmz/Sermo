import type { Scenario } from "../harness";

export const scenarios: Scenario[] = [
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
];
