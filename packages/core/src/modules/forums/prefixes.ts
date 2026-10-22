import { requireAuthenticated } from "../../actor";
import { type Ctx, invalidate } from "../../context";
import * as contracts from "../../contracts/forums";
import { writeTx } from "../../db/tx";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { can, currentActor, requirePermission } from "../../permissions";
import { iso } from "../../time";
import { appendModeratorLog } from "../moderation";
import { type PrefixRow, prefixRows, prefixValue } from "./presentation";

/** The most prefixes and tabs the site can hold. */
export const PREFIX_LIMIT = 100;
export const TAB_LIMIT = 20;

export const prefixSql = {
  /** Is any thread carrying the prefix? An index probe on the partial index threads_prefix. */
  carried: "SELECT 1 FROM threads WHERE prefix_id = ?1 LIMIT 1",
  color: "SELECT kind, is_active FROM palette_colors WHERE id = ?1",
  count: "SELECT COUNT(*) AS n FROM thread_prefixes",
  /** The prefixes a forum offers: a primary-key range on the unique pair. */
  offered: "SELECT prefix_id FROM forum_prefixes WHERE node_id = ?1",
  clearOffered: "DELETE FROM forum_prefixes WHERE node_id = ?1",
  offer: "INSERT INTO forum_prefixes (node_id, prefix_id) VALUES (?1, ?2)",
  offerInEveryForum:
    "INSERT INTO forum_prefixes (node_id, prefix_id) SELECT id, ?1 FROM nodes WHERE type = 'forum'",
  /** One probe on the index threads_prefix (prefix, forum). */
  carriedHere: "SELECT 1 FROM threads WHERE prefix_id = ?1 AND node_id = ?2 LIMIT 1",
  required: "SELECT require_prefix FROM nodes WHERE id = ?1",
};

/** The prefixes a forum offers, in display order, active or not. */
export function offeredPrefixRows(ctx: Ctx, nodeId: number): PrefixRow[] {
  const ids = new Set(
    ctx.sqlite
      .prepare<{ prefix_id: number }, [number]>(prefixSql.offered)
      .all(nodeId)
      .map((row) => row.prefix_id),
  );
  return prefixRows(ctx).filter((row) => ids.has(row.id));
}

/**
 * A prefix a thread of the forum may newly take: it exists, is active and the forum offers it.
 * Call inside the write transaction.
 */
export function requireActivePrefix(ctx: Ctx, prefixId: number, nodeId: number): PrefixRow {
  const row = prefixRows(ctx).find((candidate) => candidate.id === prefixId);
  if (!row?.is_active) throw new ValidationError("That thread prefix is not available.");
  if (!offeredPrefixRows(ctx, nodeId).some((offered) => offered.id === prefixId))
    throw new ValidationError("That thread prefix is not available in this forum.");
  return row;
}

/**
 * A forum that requires a prefix and offers an active one refuses a thread without a prefix. A
 * forum that offers none cannot require one: nobody could post there.
 */
export function requirePrefixChosen(ctx: Ctx, nodeId: number): void {
  if (
    !ctx.sqlite.prepare<{ require_prefix: number }, [number]>(prefixSql.required).get(nodeId)
      ?.require_prefix
  )
    return;
  if (offeredPrefixRows(ctx, nodeId).some((row) => row.is_active))
    throw new ValidationError("Choose a prefix for this thread.");
}

/** A new forum offers every active prefix, as every forum did before forums chose. */
export function offerEveryActivePrefix(ctx: Ctx, nodeId: number): void {
  const insert = ctx.sqlite.prepare(prefixSql.offer);
  for (const row of prefixRows(ctx)) if (row.is_active) insert.run(nodeId, row.id);
}

/** Replaces the prefixes a forum offers. Call inside the write transaction. */
export function setOfferedPrefixes(ctx: Ctx, nodeId: number, prefixIds: readonly number[]): void {
  const known = new Set(prefixRows(ctx).map((row) => row.id));
  const wanted = [...new Set(prefixIds)];
  if (wanted.some((id) => !known.has(id))) throw new ValidationError("A thread prefix is unknown.");
  ctx.sqlite.prepare(prefixSql.clearOffered).run(nodeId);
  const insert = ctx.sqlite.prepare(prefixSql.offer);
  for (const id of wanted) insert.run(nodeId, id);
}

function requirePrefixColor(ctx: Ctx, colorId: number): void {
  const color = ctx.sqlite
    .prepare<{ kind: string; is_active: number }, [number]>(prefixSql.color)
    .get(colorId);
  if (color?.kind !== "prefix" || !color.is_active)
    throw new ValidationError("Pick an active colour from the prefix palette.");
}

function prefixRow(ctx: Ctx, id: number): PrefixRow {
  const row = ctx.sqlite
    .prepare<PrefixRow, [number]>("SELECT * FROM thread_prefixes WHERE id = ?1")
    .get(id);
  if (!row) throw new NotFoundError();
  return row;
}

/** The forum's offered prefixes, and with `carried` the ones its threads still carry. */
function listedForForum(ctx: Ctx, nodeId: number, carried: boolean): PrefixRow[] {
  const offered = offeredPrefixRows(ctx, nodeId);
  if (!carried) return offered;
  const probe = ctx.sqlite.prepare(prefixSql.carriedHere);
  const have = new Set(offered.map((row) => row.id));
  return prefixRows(ctx).filter((row) => have.has(row.id) || !!probe.get(row.id, nodeId));
}

const threadPrefixesListOp = implement(
  contracts.threadPrefixesList,
  (ctx, actor, input) => {
    const all = can(ctx, actor, "admin.prefixes") || can(ctx, actor, "admin.nodes");
    if (input.nodeId !== undefined)
      requirePermission(ctx, actor, "node.view", { nodeId: input.nodeId }, { notFound: true });
    return {
      items: (input.nodeId === undefined
        ? prefixRows(ctx)
        : listedForForum(ctx, input.nodeId, input.carried)
      )
        .filter((row) => all || row.is_active)
        .map((row) => prefixValue(ctx, row)),
    };
  },
  {
    public:
      "Anyone can list the active prefixes, or the ones a forum they may view offers; inactive ones need admin.prefixes or admin.nodes.",
  },
);

const threadPrefixesCreateOp = implement(contracts.threadPrefixesCreate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "admin.prefixes");
  const id = writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.prefixes");
    if (ctx.sqlite.prepare<{ n: number }, []>(prefixSql.count).get()!.n >= PREFIX_LIMIT)
      throw new ConflictError(`The site holds at most ${PREFIX_LIMIT} thread prefixes.`);
    requirePrefixColor(ctx, input.colorId);
    const row = ctx.sqlite
      .prepare<{ id: number }, (string | number)[]>(
        "INSERT INTO thread_prefixes (label, color_id, icon, position, is_active, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) RETURNING id",
      )
      .get(
        input.label,
        input.colorId,
        input.icon,
        input.position,
        input.isActive ? 1 : 0,
        ctx.now(),
      )!;
    if (input.offerInAllForums) ctx.sqlite.prepare(prefixSql.offerInEveryForum).run(row.id);
    invalidate(ctx, "thread_prefixes");
    appendModeratorLog(ctx, actor, "threadPrefix.create", "thread_prefix", row.id, "", {});
    return row.id;
  });
  return prefixValue(ctx, prefixRow(ctx, id));
});

const threadPrefixesUpdateOp = implement(contracts.threadPrefixesUpdate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "admin.prefixes");
  writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.prefixes");
    const row = prefixRow(ctx, input.prefixId);
    // A colour is checked when it is chosen, and again when the prefix comes back into use.
    const reactivated = input.isActive === true && !row.is_active;
    if ((input.colorId !== undefined && input.colorId !== row.color_id) || reactivated)
      requirePrefixColor(ctx, input.colorId ?? row.color_id);
    ctx.sqlite
      .prepare<unknown, (string | number)[]>(
        "UPDATE thread_prefixes SET label = ?1, color_id = ?2, icon = ?3, position = ?4, is_active = ?5, updated_at = ?6 WHERE id = ?7",
      )
      .run(
        input.label ?? row.label,
        input.colorId ?? row.color_id,
        input.icon ?? row.icon,
        input.position ?? row.position,
        (input.isActive ?? !!row.is_active) ? 1 : 0,
        ctx.now(),
        row.id,
      );
    invalidate(ctx, "thread_prefixes");
    appendModeratorLog(ctx, actor, "threadPrefix.update", "thread_prefix", row.id, "", {
      changedKeys: Object.keys(input).filter((key) => key !== "prefixId"),
    });
  });
  return prefixValue(ctx, prefixRow(ctx, input.prefixId));
});

const threadPrefixesDeleteOp = implement(contracts.threadPrefixesDelete, (ctx, actor, input) => {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "admin.prefixes");
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.prefixes");
    const row = prefixRow(ctx, input.prefixId);
    const deactivated = !!ctx.sqlite.prepare(prefixSql.carried).get(row.id);
    if (deactivated)
      ctx.sqlite
        .prepare("UPDATE thread_prefixes SET is_active = 0, updated_at = ?1 WHERE id = ?2")
        .run(ctx.now(), row.id);
    else ctx.sqlite.prepare("DELETE FROM thread_prefixes WHERE id = ?1").run(row.id);
    invalidate(ctx, "thread_prefixes");
    appendModeratorLog(ctx, actor, "threadPrefix.delete", "thread_prefix", row.id, "", {
      deactivated,
    });
    return { ok: true as const, deactivated };
  });
});

// Forum list tabs ------------------------------------------------------------

type TabRow = {
  id: number;
  title: string;
  position: number;
  created_at: number;
  updated_at: number;
};
const tabValue = (row: TabRow) => ({
  id: row.id,
  title: row.title,
  position: row.position,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
});
function tabRow(ctx: Ctx, id: number): TabRow {
  const row = ctx.sqlite
    .prepare<TabRow, [number]>("SELECT * FROM forum_tabs WHERE id = ?1")
    .get(id);
  if (!row) throw new NotFoundError();
  return row;
}

const forumTabsListOp = implement(
  contracts.forumTabsList,
  (ctx) => ({
    items: ctx.sqlite
      .prepare<TabRow, []>("SELECT * FROM forum_tabs ORDER BY position, id")
      .all()
      .map(tabValue),
  }),
  { public: "The tabs of the forum list are shown to every visitor." },
);

const forumTabsCreateOp = implement(contracts.forumTabsCreate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "admin.nodes");
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.nodes");
    const { n } = ctx.sqlite
      .prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM forum_tabs")
      .get()!;
    if (n >= TAB_LIMIT) throw new ConflictError(`The forum list holds at most ${TAB_LIMIT} tabs.`);
    const row = ctx.sqlite
      .prepare<TabRow, [string, number, number]>(
        "INSERT INTO forum_tabs (title, position, created_at, updated_at) VALUES (?1, ?2, ?3, ?3) RETURNING *",
      )
      .get(input.title, input.position, ctx.now())!;
    appendModeratorLog(ctx, actor, "forumTab.create", "forum_tab", row.id, "", {});
    return tabValue(row);
  });
});

const forumTabsUpdateOp = implement(contracts.forumTabsUpdate, (ctx, actor, input) => {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "admin.nodes");
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.nodes");
    const row = tabRow(ctx, input.tabId);
    const updated = ctx.sqlite
      .prepare<TabRow, [string, number, number, number]>(
        "UPDATE forum_tabs SET title = ?1, position = ?2, updated_at = ?3 WHERE id = ?4 RETURNING *",
      )
      .get(input.title ?? row.title, input.position ?? row.position, ctx.now(), row.id)!;
    appendModeratorLog(ctx, actor, "forumTab.update", "forum_tab", row.id, "", {
      changedKeys: Object.keys(input).filter((key) => key !== "tabId"),
    });
    return tabValue(updated);
  });
});

const forumTabsDeleteOp = implement(contracts.forumTabsDelete, (ctx, actor, input) => {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "admin.nodes");
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.nodes");
    const row = tabRow(ctx, input.tabId);
    ctx.sqlite.prepare("UPDATE nodes SET tab_id = NULL WHERE tab_id = ?1").run(row.id);
    ctx.sqlite.prepare("DELETE FROM forum_tabs WHERE id = ?1").run(row.id);
    invalidate(ctx, "node_tree");
    invalidate(ctx, "node_tabs");
    appendModeratorLog(ctx, actor, "forumTab.delete", "forum_tab", row.id, "", {});
    return { ok: true as const };
  });
});

export const forumPrefixOperations = [
  threadPrefixesListOp,
  threadPrefixesCreateOp,
  threadPrefixesUpdateOp,
  threadPrefixesDeleteOp,
  forumTabsListOp,
  forumTabsCreateOp,
  forumTabsUpdateOp,
  forumTabsDeleteOp,
];
