import type * as z from "zod";
import type { Actor } from "../../actor";
import { type Ctx, cached, invalidate } from "../../context";
import {
  type NavigationLink,
  navigationCreate,
  navigationDelete,
  navigationGet,
  navigationList,
  navigationUpdate,
} from "../../contracts/navigation";
import { NAVIGATION_LOCATIONS } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import {
  can,
  type FlagPermissionId,
  PERMISSIONS,
  type PermissionDefinition,
  type PermissionId,
  requirePermission,
} from "../../permissions";
import { iso } from "../../time";
import { appendModeratorLog } from "../moderation";

type Location = (typeof NAVIGATION_LOCATIONS)[number];
type Audience = "everyone" | "guests" | "members" | "permission";
type Link = z.infer<typeof NavigationLink>;

/** The most entries the site holds. */
export const NAVIGATION_LIMIT = 200;

interface EntryRow {
  id: number;
  location: Location;
  parent_id: number | null;
  title: string;
  target: string | null;
  position: number;
  is_enabled: number;
  audience: Audience;
  permission: string | null;
  icon: string | null;
  icon_position: "before" | "after";
  builtin: string | null;
  created_at: number;
  updated_at: number;
}

export const navigationSql = {
  all: "SELECT * FROM navigation_entries ORDER BY location, parent_id IS NOT NULL, position, id",
  one: "SELECT * FROM navigation_entries WHERE id = ?1",
  count: "SELECT COUNT(*) AS n FROM navigation_entries",
  hasChildren: "SELECT 1 FROM navigation_entries WHERE location = ?1 AND parent_id = ?2 LIMIT 1",
};

interface Snapshot {
  rows: EntryRow[];
  /** Per location, the enabled top-level entries in order, with their enabled children. */
  tree: Record<Location, { row: EntryRow; children: EntryRow[] }[]>;
}

/** Every entry, in one cache; invalidated by each write. */
function snapshot(ctx: Ctx): Snapshot {
  return cached(ctx, "navigation", () => {
    // The query orders each location; the locations themselves follow the declared order.
    const rows = ctx.sqlite
      .prepare<EntryRow, []>(navigationSql.all)
      .all()
      .sort(
        (a, b) =>
          NAVIGATION_LOCATIONS.indexOf(a.location) - NAVIGATION_LOCATIONS.indexOf(b.location),
      );
    const tree = Object.fromEntries(
      NAVIGATION_LOCATIONS.map((name) => [name, []]),
    ) as unknown as Snapshot["tree"];
    const tops = new Map<number, { row: EntryRow; children: EntryRow[] }>();
    for (const row of rows) {
      if (!row.is_enabled) continue;
      if (row.parent_id === null) {
        const top = { row, children: [] };
        tops.set(row.id, top);
        tree[row.location].push(top);
      } else tops.get(row.parent_id)?.children.push(row);
    }
    return { rows, tree };
  });
}

/** A permission an entry can be gated on: a global flag that needs no context to be checked. */
function gateable(id: string): id is FlagPermissionId {
  if (!Object.hasOwn(PERMISSIONS, id)) return false;
  const definition: PermissionDefinition = PERMISSIONS[id as PermissionId];
  return (
    definition.scope === "global" &&
    definition.type === "flag" &&
    !definition.own &&
    !definition.hierarchy &&
    !definition.timeLimit &&
    !definition.threadBan
  );
}

const entryValue = (row: EntryRow) => ({
  id: row.id,
  location: row.location,
  parentId: row.parent_id,
  title: row.title,
  target: row.target,
  position: row.position,
  isEnabled: !!row.is_enabled,
  audience: row.audience,
  permission: row.permission,
  icon: row.icon,
  iconPosition: row.icon_position,
  builtin: row.builtin,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});

const linkValue = (row: EntryRow) => ({
  id: row.id,
  title: row.title,
  target: row.target,
  builtin: row.builtin,
  icon: row.icon,
  iconPosition: row.icon_position,
});

function entryRow(ctx: Ctx, id: number): EntryRow {
  const row = ctx.sqlite.prepare<EntryRow, [number]>(navigationSql.one).get(id);
  if (!row) throw new NotFoundError();
  return row;
}

/** The audience and permission to store, checked against the registry. */
function audienceColumns(
  audience: Audience,
  permission: string | null,
): { audience: Audience; permission: string | null } {
  if (audience !== "permission") {
    if (permission !== null)
      throw new ValidationError("Only an entry shown by permission takes a permission.");
    return { audience, permission: null };
  }
  if (permission === null || !gateable(permission))
    throw new ValidationError("Pick a registered global permission.");
  return { audience, permission };
}

/** Throws unless `parentId` is a top-level entry of `location` (and is not the entry itself). */
function requireParent(ctx: Ctx, parentId: number, location: Location, selfId?: number): void {
  if (parentId === selfId) throw new ValidationError("An entry cannot be its own parent.");
  const parent = ctx.sqlite.prepare<EntryRow, [number]>(navigationSql.one).get(parentId);
  if (!parent) throw new ValidationError("The parent entry does not exist.");
  if (parent.parent_id !== null) throw new ValidationError("A parent must be a top-level entry.");
  if (parent.location !== location)
    throw new ValidationError("A child sits in the same location as its parent.");
}

const get = implement(
  navigationGet,
  (ctx, actor) => {
    const { tree } = snapshot(ctx);
    const verdicts = new Map<string, boolean>();
    const shown = (row: EntryRow, viewer: Actor): boolean => {
      switch (row.audience) {
        case "everyone":
          return true;
        case "guests":
          return viewer.kind === "guest";
        case "members":
          return viewer.kind !== "guest";
        case "permission": {
          const id = row.permission;
          if (id === null || !gateable(id)) return false;
          let verdict = verdicts.get(id);
          if (verdict === undefined) {
            verdict = can(ctx, viewer, id);
            verdicts.set(id, verdict);
          }
          return verdict;
        }
      }
    };
    const result = {} as Record<Location, (Link | undefined)[]>;
    for (const location of NAVIGATION_LOCATIONS) {
      result[location] = [];
      for (const top of tree[location]) {
        if (!shown(top.row, actor)) continue;
        const children = top.children.filter((child) => shown(child, actor)).map(linkValue);
        if (top.row.target === null && children.length === 0) continue;
        result[location].push({ ...linkValue(top.row), children });
      }
    }
    return result as Record<Location, Link[]>;
  },
  { public: "The site's links are what every visitor sees; audiences filter them per visitor." },
);

const list = implement(navigationList, (ctx, actor) => {
  requirePermission(ctx, actor, "admin.settings");
  return { items: snapshot(ctx).rows.map(entryValue) };
});

const create = implement(navigationCreate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.settings");
  return writeTx(ctx, () => {
    if (ctx.sqlite.prepare<{ n: number }, []>(navigationSql.count).get()!.n >= NAVIGATION_LIMIT)
      throw new ConflictError(`The site holds at most ${NAVIGATION_LIMIT} navigation entries.`);
    if (input.parentId !== null) requireParent(ctx, input.parentId, input.location);
    const columns = audienceColumns(input.audience, input.permission);
    const row = ctx.sqlite
      .prepare<EntryRow, (string | number | null)[]>(
        "INSERT INTO navigation_entries (location, parent_id, title, target, position, is_enabled, audience, permission, icon, icon_position, builtin, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, NULL, ?11, ?11) RETURNING *",
      )
      .get(
        input.location,
        input.parentId,
        input.title,
        input.target,
        input.position,
        input.isEnabled ? 1 : 0,
        columns.audience,
        columns.permission,
        input.icon,
        input.iconPosition,
        ctx.now(),
      )!;
    invalidate(ctx, "navigation");
    appendModeratorLog(ctx, actor, "navigation.create", "navigation_entry", row.id, "", {
      location: input.location,
    });
    return entryValue(row);
  });
});

const update = implement(navigationUpdate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.settings");
  return writeTx(ctx, () => {
    const row = entryRow(ctx, input.entryId);
    const location = input.location ?? row.location;
    const parentId = input.parentId === undefined ? row.parent_id : input.parentId;
    const target = input.target === undefined ? row.target : input.target;
    if (
      row.builtin !== null &&
      (location !== row.location || parentId !== row.parent_id || target !== row.target)
    )
      throw new ConflictError("A built-in entry keeps its location, parent and target.");
    const hasChildren = !!ctx.sqlite
      .prepare<{ 1: number }, [string, number]>(navigationSql.hasChildren)
      .get(row.location, row.id);
    if (hasChildren && (parentId !== null || location !== row.location))
      throw new ValidationError(
        "An entry with children cannot move to another location or under another entry.",
      );
    if (parentId !== null) requireParent(ctx, parentId, location, row.id);
    const audience = input.audience ?? row.audience;
    const columns =
      input.audience !== undefined || input.permission !== undefined
        ? audienceColumns(
            audience,
            input.permission !== undefined
              ? input.permission
              : audience === "permission"
                ? row.permission
                : null,
          )
        : { audience: row.audience, permission: row.permission };
    ctx.sqlite
      .prepare<unknown, (string | number | null)[]>(
        "UPDATE navigation_entries SET location = ?1, parent_id = ?2, title = ?3, target = ?4, position = ?5, is_enabled = ?6, audience = ?7, permission = ?8, icon = ?9, icon_position = ?10, updated_at = ?11 WHERE id = ?12",
      )
      .run(
        location,
        parentId,
        input.title ?? row.title,
        target,
        input.position ?? row.position,
        (input.isEnabled ?? !!row.is_enabled) ? 1 : 0,
        columns.audience,
        columns.permission,
        input.icon === undefined ? row.icon : input.icon,
        input.iconPosition ?? row.icon_position,
        ctx.now(),
        row.id,
      );
    invalidate(ctx, "navigation");
    appendModeratorLog(ctx, actor, "navigation.update", "navigation_entry", row.id, "", {
      changedKeys: Object.keys(input).filter((key) => key !== "entryId"),
    });
    return entryValue(entryRow(ctx, row.id));
  });
});

const remove = implement(navigationDelete, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.settings");
  return writeTx(ctx, () => {
    const row = entryRow(ctx, input.entryId);
    if (row.builtin !== null) throw new ConflictError("A built-in entry cannot be deleted.");
    const children = ctx.sqlite
      .prepare("DELETE FROM navigation_entries WHERE parent_id = ?1")
      .run(row.id).changes;
    ctx.sqlite.prepare("DELETE FROM navigation_entries WHERE id = ?1").run(row.id);
    invalidate(ctx, "navigation");
    appendModeratorLog(ctx, actor, "navigation.delete", "navigation_entry", row.id, "", {
      children,
    });
    return { ok: true as const };
  });
});

export const operations = [get, list, create, update, remove];
