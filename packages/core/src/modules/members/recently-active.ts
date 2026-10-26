import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { usersRecentlyActive } from "../../contracts/members";
import { implement } from "../../operation";
import { requirePermission } from "../../permissions";
import { iso } from "../../time";
import { blockedMembers } from "../social/blocks";
import { isBanned } from "./access";
import { loadViewerCards } from "./cards";
import { recentlyActiveCache as listCache, type RecentlyActiveList } from "./recently-active-cache";
import { requireSiteView } from "./site-access";

/** How far back the list reaches. */
export const RECENTLY_ACTIVE_WINDOW_MS = 24 * 60 * 60_000;
/** The most members the list holds; `total` counts them all. */
export const RECENTLY_ACTIVE_LIMIT = 200;
/** How long the list is kept: it is the same for every viewer. */
export const RECENTLY_ACTIVE_CACHE_MS = 60_000;
const MINUTE_MS = 60_000;

interface ActiveRow {
  id: number;
  last_activity_at: number | null;
  banned_until: number | null;
  banned_permanently: number;
}

/** Stored activity in the window, newest first, through the partial index on the time. */
export const recentlyActiveSql = {
  stored:
    "SELECT id, last_activity_at, banned_until, banned_permanently FROM users INDEXED BY users_last_activity WHERE last_activity_at >= ?1 AND show_online = 1 AND erased_at IS NULL ORDER BY last_activity_at DESC, id DESC",
  /** The members with activity buffered by running requests and not flushed yet. */
  buffered:
    "SELECT id, last_activity_at, banned_until, banned_permanently FROM users WHERE id IN (SELECT value FROM json_each(?1)) AND show_online = 1 AND erased_at IS NULL",
};

type Listed = RecentlyActiveList;

function listRecentlyActive(ctx: Ctx, now: number): Listed {
  const since = now - RECENTLY_ACTIVE_WINDOW_MS;
  const seen = new Map<number, number>();
  const keep = (row: ActiveRow) => {
    // The newer of the stored time and the one buffered by a running request.
    const at = Math.max(row.last_activity_at ?? 0, ctx.activity.get(row.id) ?? 0);
    if (at >= since && !isBanned(row, now)) seen.set(row.id, at);
  };
  for (const row of prepared(ctx, "members.recentlyActive", () =>
    ctx.sqlite.prepare<ActiveRow, [number]>(recentlyActiveSql.stored),
  ).all(since))
    keep(row);
  const pending = [...ctx.activity]
    .filter(([id, at]) => at >= since && !seen.has(id))
    .map(([id]) => id);
  if (pending.length > 0)
    for (const row of prepared(ctx, "members.recentlyActiveBuffered", () =>
      ctx.sqlite.prepare<ActiveRow, [string]>(recentlyActiveSql.buffered),
    ).all(JSON.stringify(pending)))
      keep(row);
  const members = [...seen]
    .map(([id, at]) => ({ id, at }))
    .sort((a, b) => b.at - a.at || b.id - a.id);
  return { total: members.length, members: members.slice(0, RECENTLY_ACTIVE_LIMIT) };
}

export const usersRecentlyActiveOp = implement(usersRecentlyActive, (ctx, actor) => {
  requireSiteView(ctx, actor);
  requirePermission(ctx, actor, "profile.view");
  requirePermission(ctx, actor, "member.viewList");
  const now = ctx.now();
  const kept = listCache.get(ctx);
  let listed: Listed;
  if (kept && now >= kept.at && now - kept.at < RECENTLY_ACTIVE_CACHE_MS) listed = kept.listed;
  else {
    listed = listRecentlyActive(ctx, now);
    listCache.set(ctx, { at: now, listed });
  }
  // Only the cards depend on the viewer: a profile they may not open gets the minimal card, and
  // members in a block with them are left out.
  const blocked = new Set(blockedMembers(ctx, actor));
  const cards = loadViewerCards(
    ctx,
    actor,
    listed.members.map((member) => member.id).filter((id) => !blocked.has(id)),
  );
  return {
    total: listed.total,
    items: listed.members.flatMap((member) => {
      const card = cards.get(member.id);
      return card ? [{ card, lastActivityAt: iso(member.at - (member.at % MINUTE_MS)) }] : [];
    }),
  };
});
