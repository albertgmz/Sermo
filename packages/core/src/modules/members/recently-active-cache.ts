import type { Ctx } from "../../context";

/**
 * The kept `users.recentlyActive` list, apart from the read so the writes that drop it (privacy,
 * bans, erasure) import nothing else.
 */
export type RecentlyActiveList = { total: number; members: { id: number; at: number }[] };
export const recentlyActiveCache = new WeakMap<Ctx, { at: number; listed: RecentlyActiveList }>();

/** Drops the kept list, so a member who just hid their status, or was banned or erased, leaves it. */
export function forgetRecentlyActive(ctx: Ctx): void {
  recentlyActiveCache.delete(ctx);
}
