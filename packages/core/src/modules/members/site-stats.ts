import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { siteStats } from "../../contracts/members";
import { GROUP_IDS } from "../../db/schema";
import { implement } from "../../operation";
import { can, viewableNodeIds } from "../../permissions";
import { isBanned } from "./access";
import { loadViewerCards } from "./cards";
import { requireSiteView } from "./site-access";

/** How long the totals are kept: they are the same for every viewer. */
export const SITE_STATS_CACHE_MS = 10 * 60_000;
/** How many of the newest accounts are looked at to find one that is not banned. */
const NEWEST_SCAN = 20;

/** An account that counts as a member: confirmed, approved and not erased. */
const COUNTED = `u.erased_at IS NULL AND u.group_id <> ${GROUP_IDS.unconfirmed} AND u.signup_review IS NULL`;

export const siteStatsSql = {
  nodes: "SELECT id, thread_count, post_count FROM nodes",
  members: `SELECT COUNT(*) AS n FROM users u WHERE ${COUNTED} AND u.banned_permanently = 0 AND (u.banned_until IS NULL OR u.banned_until <= ?1)`,
  newest: `SELECT u.id, u.banned_until, u.banned_permanently FROM users u WHERE ${COUNTED} ORDER BY u.id DESC LIMIT ${NEWEST_SCAN}`,
};

interface Totals {
  threads: number;
  posts: number;
  members: number;
  latestId: number | null;
}

const kept = new WeakMap<Ctx, { at: number; totals: Totals }>();

/** Drops the kept totals (a test that changes the data reads them again). */
export function forgetSiteStats(ctx: Ctx): void {
  kept.delete(ctx);
}

function countTotals(ctx: Ctx, now: number): Totals {
  const visible = new Set(viewableNodeIds(ctx, GUEST));
  let threads = 0;
  let posts = 0;
  for (const node of prepared(ctx, "members.siteStatsNodes", () =>
    ctx.sqlite.prepare<{ id: number; thread_count: number; post_count: number }, []>(
      siteStatsSql.nodes,
    ),
  ).all())
    if (visible.has(node.id)) {
      threads += node.thread_count;
      posts += node.post_count;
    }
  const members =
    prepared(ctx, "members.siteStatsMembers", () =>
      ctx.sqlite.prepare<{ n: number }, [number]>(siteStatsSql.members),
    ).get(now)?.n ?? 0;
  const newest = prepared(ctx, "members.siteStatsNewest", () =>
    ctx.sqlite.prepare<{ id: number; banned_until: number | null; banned_permanently: number }, []>(
      siteStatsSql.newest,
    ),
  )
    .all()
    .find((row) => !isBanned(row, now));
  return { threads, posts, members, latestId: newest?.id ?? null };
}

export const siteStatsOp = implement(siteStats, (ctx, actor) => {
  requireSiteView(ctx, actor);
  const now = ctx.now();
  let entry = kept.get(ctx);
  if (!entry || now < entry.at || now - entry.at >= SITE_STATS_CACHE_MS) {
    entry = { at: now, totals: countTotals(ctx, now) };
    kept.set(ctx, entry);
  }
  const { threads, posts, members, latestId } = entry.totals;
  // Only the card depends on the viewer, and only a viewer who may list members is shown it.
  const mayList = can(ctx, actor, "profile.view") && can(ctx, actor, "member.viewList");
  const card =
    mayList && latestId !== null
      ? (loadViewerCards(ctx, actor, [latestId]).get(latestId) ?? null)
      : null;
  return { threads, posts, members, latestMember: card };
});
