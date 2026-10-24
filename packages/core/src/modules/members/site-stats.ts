import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { siteStats } from "../../contracts/members";
import { GROUP_IDS, GUEST_ACCOUNT_ID } from "../../db/schema";
import { implement } from "../../operation";
import { can, viewableNodeIds } from "../../permissions";
import { loadViewerCards } from "./cards";
import { requireSiteView } from "./site-access";
import { siteStatsCache as kept, type SiteTotals } from "./site-stats-cache";

/** How long the totals are kept: they are the same for every viewer. */
export const SITE_STATS_CACHE_MS = 10 * 60_000;

/** An account that counts as a member: confirmed, approved, not erased and not the guest account. */
const COUNTED = `u.erased_at IS NULL AND u.group_id <> ${GROUP_IDS.unconfirmed} AND u.signup_review IS NULL AND u.id <> ${GUEST_ACCOUNT_ID}`;

/** Not banned at the time `?1`. */
const NOT_BANNED = "u.banned_permanently = 0 AND (u.banned_until IS NULL OR u.banned_until <= ?1)";

export const siteStatsSql = {
  nodes: "SELECT id, thread_count, post_count FROM nodes",
  members: `SELECT COUNT(*) AS n FROM users u WHERE ${COUNTED} AND ${NOT_BANNED}`,
  /** The newest member: the primary key walked backwards until the first account that counts. */
  newest: `SELECT u.id FROM users u WHERE ${COUNTED} AND ${NOT_BANNED} ORDER BY u.id DESC LIMIT 1`,
};

function countTotals(ctx: Ctx, now: number): SiteTotals {
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
    ctx.sqlite.prepare<{ id: number }, [number]>(siteStatsSql.newest),
  ).get(now);
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
