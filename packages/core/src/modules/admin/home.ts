import type { Actor } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { ACTIVITY_KINDS, adminActivity, adminJobs, adminStaffOnline } from "../../contracts/admin";
import { NotFoundError } from "../../errors";
import { implement } from "../../operation";
import {
  can,
  permissionsOf,
  requirePermission,
  resolvedPermissions,
  viewableNodeIds,
} from "../../permissions";
import { iso } from "../../time";
import { staffAccess } from "../auth/staff";
import { loadMemberCards } from "../members/cards";
import { staffMembership } from "../members/directory";

const DAY = 86_400_000;
type Kind = (typeof ACTIVITY_KINDS)[number];

// admin.activity ----------------------------------------------------------------------------

/**
 * Counts per window over one table, in the window of the last thirty days only. Rows are located
 * by an index on their time (`indexed`) or, where the table has none, by the primary key: ids
 * grow with time, so the first row of the window is found by bisecting on the key (about 20
 * probes) and the counts read from there. A row created in the window with a lower id than an
 * older one (an import) would be missed; rows written by the application never are.
 */
const countSql = {
  moderation:
    "SELECT coalesce(sum(created_at >= ?1), 0) AS day, coalesce(sum(created_at >= ?2), 0) AS week, count(*) AS month FROM moderator_log WHERE created_at >= ?3",
  promotions:
    "SELECT coalesce(sum(created_at >= ?1), 0) AS day, coalesce(sum(created_at >= ?2), 0) AS week, count(*) AS month FROM promotion_log WHERE created_at >= ?3 AND action = 'promote'",
  creditAdjustments:
    "SELECT coalesce(sum(created_at >= ?1), 0) AS day, coalesce(sum(created_at >= ?2), 0) AS week, count(*) AS month FROM credit_transactions WHERE type = 'adjustment' AND created_at >= ?3",
} as const;
const KEYED_TABLES = {
  reports: "reports",
  shopPurchases: "shop_purchases",
  registrations: "users",
} as const;
export const keyedCountSql = (table: string) =>
  `SELECT coalesce(sum(created_at >= ?1), 0) AS day, coalesce(sum(created_at >= ?2), 0) AS week, count(*) AS month FROM ${table} WHERE id >= ?4 AND created_at >= ?3`;
export const probeSql = (table: string) =>
  `SELECT id, created_at FROM ${table} WHERE id >= ?1 ORDER BY id LIMIT 1`;
export const topSql = (table: string) => `SELECT max(id) AS id FROM ${table}`;

interface Counts {
  day: number;
  week: number;
  month: number;
}

function firstIdSince(ctx: Ctx, table: string, since: number): number {
  const probe = prepared(ctx, `admin.probe.${table}`, () =>
    ctx.sqlite.prepare<{ id: number; created_at: number }, [number]>(probeSql(table)),
  );
  const top = ctx.sqlite.prepare<{ id: number | null }, []>(topSql(table)).get()?.id ?? 0;
  let low = 1;
  let high = top + 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const found = probe.get(middle);
    if (found && found.created_at >= since) high = middle;
    else low = found ? Math.min(found.id + 1, high) : high;
  }
  return low;
}

function count(ctx: Ctx, kind: Kind, now: number): Counts {
  const windows = [now - DAY, now - 7 * DAY, now - 30 * DAY] as const;
  if (kind === "moderation" || kind === "promotions" || kind === "creditAdjustments")
    return prepared(ctx, `admin.count.${kind}`, () =>
      ctx.sqlite.prepare<Counts, [number, number, number]>(countSql[kind]),
    ).get(...windows)!;
  const table = KEYED_TABLES[kind];
  return prepared(ctx, `admin.count.${kind}`, () =>
    ctx.sqlite.prepare<Counts, [number, number, number, number]>(keyedCountSql(table)),
  ).get(...windows, firstIdSince(ctx, table, windows[2]))!;
}

/** Whether the actor may read the report queue: of profiles and members, of messages, or of a forum. */
function mayReadReports(ctx: Ctx, actor: Actor): boolean {
  const grants = permissionsOf(ctx, actor);
  return (
    grants.can("report.manageProfiles") ||
    grants.can("conversation.moderate") ||
    viewableNodeIds(ctx, actor).some((nodeId) => grants.can("forum.manageReports", { nodeId }))
  );
}

export const adminActivityOp = implement(adminActivity, (ctx, actor) => {
  // admin.members is checked against a member where one is acted on; here it only says whether
  // the actor holds it, which the resolved permissions state without a target.
  const held = resolvedPermissions(ctx, actor);
  const readable: Record<Kind, boolean> = {
    moderation: can(ctx, actor, "moderatorLog.view"),
    reports: mayReadReports(ctx, actor),
    creditAdjustments: can(ctx, actor, "credits.viewAny"),
    shopPurchases: can(ctx, actor, "admin.shop"),
    promotions: can(ctx, actor, "admin.promotions"),
    registrations: held["admin.members"] === true,
  };
  const kinds = ACTIVITY_KINDS.filter((kind) => readable[kind]);
  if (kinds.length === 0) throw new NotFoundError();
  const now = ctx.now();
  return { items: kinds.map((kind) => ({ kind, ...count(ctx, kind, now) })) };
});

// admin.staffOnline -------------------------------------------------------------------------

const ONLINE_WINDOW_MS = 15 * 60_000;
const ONLINE_LIMIT = 50;
const ACTIVITY_SQL =
  "SELECT id, last_activity_at FROM users WHERE id IN (SELECT value FROM json_each(?1))";

export const adminStaffOnlineOp = implement(adminStaffOnline, (ctx, actor) => {
  if (!staffAccess(ctx, actor, resolvedPermissions(ctx, actor)).panel) throw new NotFoundError();
  const { staffGroupsOf } = staffMembership(ctx);
  if (staffGroupsOf.size === 0) return { items: [] };
  const since = ctx.now() - ONLINE_WINDOW_MS;
  const seen: { id: number; at: number }[] = [];
  for (const row of prepared(ctx, "admin.staffActivity", () =>
    ctx.sqlite.prepare<{ id: number; last_activity_at: number | null }, [string]>(ACTIVITY_SQL),
  ).all(JSON.stringify([...staffGroupsOf.keys()]))) {
    // The newer of the stored time and the one buffered by a running request.
    const at = Math.max(row.last_activity_at ?? 0, ctx.activity.get(row.id) ?? 0);
    if (at >= since) seen.push({ id: row.id, at });
  }
  seen.sort((a, b) => b.at - a.at || a.id - b.id);
  const page = seen.slice(0, ONLINE_LIMIT);
  const cards = loadMemberCards(
    ctx,
    actor,
    page.map((row) => row.id),
  );
  return {
    items: page.flatMap((row) => {
      const card = cards.get(row.id);
      return card ? [{ card, lastActivityAt: iso(row.at) }] : [];
    }),
  };
});

// admin.jobs --------------------------------------------------------------------------------

export const jobsSql = {
  counts:
    "SELECT status, count(*) AS n FROM jobs WHERE status IN ('pending', 'running', 'failed') GROUP BY status",
  oldestDue:
    "SELECT run_at FROM jobs WHERE status = 'pending' AND run_at <= ?1 ORDER BY run_at, id LIMIT 1",
  failures:
    "SELECT id, type, last_error, updated_at FROM jobs WHERE status = 'failed' ORDER BY run_at DESC, id DESC LIMIT 20",
};
const ERROR_LENGTH = 2000;

export const adminJobsOp = implement(adminJobs, (ctx, actor) => {
  requirePermission(ctx, actor, "admin.settings");
  const totals = new Map(
    prepared(ctx, "admin.jobCounts", () =>
      ctx.sqlite.prepare<{ status: string; n: number }, []>(jobsSql.counts),
    )
      .all()
      .map((row) => [row.status, row.n] as const),
  );
  const oldest = prepared(ctx, "admin.jobOldest", () =>
    ctx.sqlite.prepare<{ run_at: number }, [number]>(jobsSql.oldestDue),
  ).get(ctx.now());
  return {
    pending: totals.get("pending") ?? 0,
    running: totals.get("running") ?? 0,
    failed: totals.get("failed") ?? 0,
    oldestPendingAt: oldest ? iso(oldest.run_at) : null,
    failures: prepared(ctx, "admin.jobFailures", () =>
      ctx.sqlite.prepare<
        { id: number; type: string; last_error: string | null; updated_at: number },
        []
      >(jobsSql.failures),
    )
      .all()
      .map((row) => ({
        id: row.id,
        type: row.type,
        error: (row.last_error ?? "").slice(0, ERROR_LENGTH),
        failedAt: iso(row.updated_at),
      })),
  };
});
