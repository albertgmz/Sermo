import type { Scenario } from "../harness";

let permissionsSetGroupId: number;
let membershipGroupId: number;
let explainAuthorization: string;
export const scenarios: Scenario[] = [
  {
    name: "groups.list",
    kind: "read",
    run: (env) => env.call("groups.list", env.actors.admin, {}),
  },
  {
    name: "permissions.list",
    kind: "read",
    run: (env) => env.call("permissions.list", env.actors.admin, { groupId: 2 }),
  },
  {
    name: "permissions.set",
    kind: "write",
    async setup(env) {
      permissionsSetGroupId = (
        JSON.parse(
          (await env.call("groups.create", env.actors.admin, {
            title: "Benchmark group",
            rank: 20,
          })) as string,
        ) as { id: number }
      ).id;
    },
    run(env) {
      const nodeId = env.meta.forumIds[0]!;
      const row = env.ctx.sqlite
        .prepare<{ value: number }, [number, number]>(
          "SELECT e.value FROM permission_entries e JOIN permission_definitions d ON d.id = e.permission_id WHERE e.group_id = ?1 AND e.node_id = ?2 AND d.key = 'forum.reply'",
        )
        .get(permissionsSetGroupId, nodeId);
      return env.call("permissions.set", env.actors.admin, {
        groupId: permissionsSetGroupId,
        nodeId,
        entries: [{ permission: "forum.reply", value: row?.value === 1 ? "no" : "allow" }],
      });
    },
  },
  {
    name: "users.setGroups",
    kind: "write",
    async setup(env) {
      membershipGroupId = (
        JSON.parse(
          (await env.call("groups.create", env.actors.admin, {
            title: "Membership benchmark",
            rank: 20,
          })) as string,
        ) as { id: number }
      ).id;
    },
    run(env) {
      const userId = env.meta.memberIds[0]!;
      const current = env.ctx.sqlite
        .prepare<{ id: number }, [number, number]>(
          "SELECT id FROM user_groups WHERE user_id = ?1 AND group_id = ?2",
        )
        .get(userId, membershipGroupId);
      return env.call("users.setGroups", env.actors.admin, {
        userId,
        secondaryGroupIds: current ? [] : [membershipGroupId],
      });
    },
  },
  {
    name: "permissions.explain",
    kind: "read",
    async setup(env) {
      explainAuthorization = await env.authHeader(env.actors.admin);
    },
    async run(env) {
      const response = await env.request("/mcp", {
        method: "POST",
        headers: {
          authorization: explainAuthorization,
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "permissions_explain",
            arguments: { userId: env.meta.memberIds[0]!, permission: "admin.groups" },
          },
        }),
      });
      if (!response.ok) throw new Error(`permissions.explain -> ${response.status}`);
      const body = await response.text();
      if (body.includes('"isError":true')) throw new Error(body);
    },
  },
];
