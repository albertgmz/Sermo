import { insertUser, userActor } from "@sermo/core/testing";
import type { Ctx } from "../../context";

/** One entry of a group at a node (0 is global): 1 allow, -1 never, 0 no, or an integer value. */
export function setEntry(ctx: Ctx, groupId: number, key: string, value: number, nodeId = 0) {
  ctx.sqlite
    .prepare(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) SELECT id, ?4, ?1, 0, ?2 FROM permission_definitions WHERE key = ?3 ON CONFLICT (group_id, user_id, node_id, permission_id) DO UPDATE SET value = excluded.value",
    )
    .run(groupId, value, key, nodeId);
  ctx.sqlite
    .prepare("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'")
    .run();
}

/**
 * A member of a new group that holds exactly the given permissions: a name grants a flag, a
 * pair sets an integer. The group ranks 10 unless told otherwise, below the moderators.
 */
export function customMember(ctx: Ctx, grants: (string | [string, number])[], rank = 10) {
  const groupId = ctx.sqlite
    .prepare<{ id: number }, [number]>(
      "INSERT INTO groups (title, rank) VALUES ('Custom ' || abs(random() % 100000), ?1) RETURNING id",
    )
    .get(rank)!.id;
  for (const grant of grants)
    if (typeof grant === "string") setEntry(ctx, groupId, grant, 1);
    else setEntry(ctx, groupId, grant[0], grant[1]);
  const row = insertUser(ctx, { groupId });
  return { groupId, row, actor: userActor(row) };
}
