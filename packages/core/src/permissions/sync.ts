import type { Ctx } from "../context";
import { writeTx } from "../db/tx";
import { PERMISSION_IDS, PERMISSIONS, type PermissionDefinition } from "./registry";

/**
 * Stores registry permissions the database does not know yet and applies their defaults to the
 * built-in groups, once. Runs where migrations run (the process that owns the schema), so a
 * permission added to the registry appears in the admin API with no further work. Existing
 * definitions and entries are never touched: admins own them after the first sync.
 */
export function syncPermissionRegistry(ctx: Ctx): number {
  return writeTx(ctx, () => {
    const known = new Set(
      ctx.sqlite
        .prepare<{ key: string }, []>("SELECT key FROM permission_definitions")
        .all()
        .map((row) => row.key),
    );
    const missing = PERMISSION_IDS.filter((id) => !known.has(id));
    if (missing.length === 0) return 0;
    const builtin = new Map(
      ctx.sqlite
        .prepare<{ id: number; builtin: string }, []>(
          "SELECT id, builtin FROM groups WHERE builtin IS NOT NULL",
        )
        .all()
        .map((row) => [row.builtin, row.id]),
    );
    const insertDefinition = ctx.sqlite.prepare<{ id: number }, [string, string, string, number]>(
      "INSERT INTO permission_definitions (key, scope, value_type, created_at) VALUES (?1, ?2, ?3, ?4) RETURNING id",
    );
    const insertEntry = ctx.sqlite.prepare<unknown, [number, number, number]>(
      "INSERT INTO permission_entries (permission_id, node_id, group_id, user_id, value) VALUES (?1, 0, ?2, 0, ?3)",
    );
    for (const id of missing) {
      const def: PermissionDefinition = PERMISSIONS[id];
      const row = insertDefinition.get(id, def.scope, def.type, ctx.now())!;
      for (const [group, value] of Object.entries(def.defaults)) {
        const groupId = builtin.get(group);
        if (groupId === undefined) continue;
        insertEntry.run(
          row.id,
          groupId,
          typeof value === "number" ? value : value === "allow" ? 1 : -1,
        );
      }
    }
    return missing.length;
  });
}
