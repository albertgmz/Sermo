import type { Scenario } from "../harness";

/** A member who moderates one forum through an entry of their own. */
let singleForumModeratorId: number;

export const scenarios: Scenario[] = [
  {
    name: "auth.me as a member",
    kind: "read",
    run: (env, i) => env.call("auth.me", env.actors.member(i), {}),
  },
  {
    name: "auth.me as a single-forum moderator",
    kind: "read",
    async setup(env) {
      singleForumModeratorId = env.meta.memberIds[env.meta.memberIds.length - 1]!;
      await env.call("permissions.set", env.actors.admin, {
        userId: singleForumModeratorId,
        nodeId: env.meta.forumIds[0]!,
        entries: [{ permission: "forum.lock", value: "allow" }],
      });
    },
    run: (env) => env.call("auth.me", env.actors.user(singleForumModeratorId), {}),
  },
  {
    name: "admin.activity",
    kind: "read",
    run: (env) => env.call("admin.activity", env.actors.admin, {}),
  },
  {
    name: "users.adminList first page",
    kind: "read",
    run: (env) => env.call("users.adminList", env.actors.admin, { limit: 20 }),
  },
  {
    name: "bans.list",
    kind: "read",
    run: (env) => env.call("bans.list", env.actors.admin, { limit: 20 }),
  },
];
