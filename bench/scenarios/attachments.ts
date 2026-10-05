import type { Scenario } from "../harness";

let threadIds: number[] = [];

export const scenarios: Scenario[] = [
  {
    name: "attachments posts.list seeded page",
    kind: "read",
    setup(env) {
      threadIds = env.ctx.sqlite
        .prepare<{ thread_id: number }, []>(
          "SELECT thread_id FROM posts WHERE id <= 300000 GROUP BY thread_id HAVING count(*) >= 5 LIMIT 20",
        )
        .all()
        .map((row) => row.thread_id);
      if (!threadIds.length) throw new Error("Attachment benchmark seed has no populated thread.");
    },
    run(env, i) {
      return env.call("posts.list", env.actors.moderator(i), {
        threadId: threadIds[i % threadIds.length]!,
        page: 1,
        limit: 20,
      });
    },
  },
];
