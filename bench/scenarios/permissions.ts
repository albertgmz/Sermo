import type { Scenario } from "../harness";

export const scenarios: Scenario[] = [
  {
    name: "groups.list",
    kind: "read",
    run: (env) => env.call("groups.list", env.actors.admin, {}),
  },
  {
    name: "permissions.setNode",
    kind: "write",
    run(env, i) {
      return env.call("permissions.setNode", env.actors.admin, {
        nodeId: env.meta.forumIds[i % env.meta.forumIds.length]!,
        groupId: 2,
        canView: null,
        canPost: i % 2 === 0,
        canModerate: null,
      });
    },
  },
];
