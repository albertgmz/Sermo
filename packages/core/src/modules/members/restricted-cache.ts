import { type Ctx, prepared } from "../../context";
import { AWAITING_SQL } from "../../permissions";

/**
 * The members whose profile is not open to everyone, with the mode that closes it (an account
 * awaiting approval counts as `self`): the figure the members directory places its numbered pages
 * by. It is one scan of `users` (no index holds it), so it is never read on a request's way: the
 * last list is served, and it is read again by the scheduler every minute, once at startup, and in
 * the background (after the response, one at a time) when a request finds it older than a minute or
 * a member just changed their privacy. A stale list can only shift a total or a page boundary by
 * the members who changed in that minute; the page itself is read live and never returns a member
 * the viewer may not open.
 */
export type RestrictedProfile = { id: number; mode: "members" | "followed" | "self" };

/** How long the list is served before a request starts reading it again. */
export const RESTRICTED_PROFILES_MS = 60_000;

export const restrictedSql = `SELECT u.id, CASE WHEN ${AWAITING_SQL} THEN 'self' ELSE u.profile_view_privacy END AS mode FROM users u WHERE (${AWAITING_SQL}) OR u.profile_view_privacy <> 'everyone'`;

type Kept = { at: number; rows: RestrictedProfile[]; stale: boolean; refreshing: boolean };
const kept = new WeakMap<Ctx, Kept>();

/** Reads the list now, on the caller's thread: startup and the scheduler's tick. */
export function refreshClosedProfiles(ctx: Ctx): void {
  const rows = prepared(ctx, "members.restrictedProfiles", () =>
    ctx.sqlite.prepare<RestrictedProfile, []>(restrictedSql),
  ).all();
  kept.set(ctx, { at: ctx.now(), rows, stale: false, refreshing: false });
}

/** Reads the list again after the response that asked for it, one read at a time. */
function refreshLater(ctx: Ctx, entry: Kept): void {
  if (entry.refreshing) return;
  entry.refreshing = true;
  setImmediate(() => {
    try {
      refreshClosedProfiles(ctx);
    } catch (error) {
      // The old list stays; the next request tries again.
      entry.refreshing = false;
      console.error("[members] closed profiles could not be read", error);
    }
  });
}

/**
 * The list served to a request. Only a context that never read it (no scheduler: scripts, tests)
 * reads it here; any other serves the last list, however old, and has it renewed in the background.
 */
export function closedProfiles(ctx: Ctx): RestrictedProfile[] {
  const entry = kept.get(ctx);
  if (!entry) {
    refreshClosedProfiles(ctx);
    return kept.get(ctx)!.rows;
  }
  const now = ctx.now();
  if (entry.stale || now < entry.at || now - entry.at >= RESTRICTED_PROFILES_MS)
    refreshLater(ctx, entry);
  return entry.rows;
}

/** A member changed their privacy: the list is renewed in the background, and served as it is. */
export function markClosedProfilesStale(ctx: Ctx): void {
  const entry = kept.get(ctx);
  if (!entry) return;
  entry.stale = true;
  refreshLater(ctx, entry);
}
