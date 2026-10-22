import type { Ctx } from "../../context";

/**
 * The kept `site.stats` totals, apart from the read so the writes that drop them (bans, erasures)
 * import nothing else.
 */
export type SiteTotals = {
  threads: number;
  posts: number;
  members: number;
  latestId: number | null;
};
export const siteStatsCache = new WeakMap<Ctx, { at: number; totals: SiteTotals }>();

/** Drops the kept totals, so a member just banned or erased is no longer counted or named. */
export function forgetSiteStats(ctx: Ctx): void {
  siteStatsCache.delete(ctx);
}
