import { type Actor, GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { can } from "../../permissions";

/**
 * Refuses a viewer who lacks `site.view`: the entry points that read the site's content (forums,
 * threads, feeds, search, profiles, the member list and the member pages) call this first. A guest
 * is asked to sign in, a member is told the site is closed to them.
 */
export function requireSiteView(ctx: Ctx, actor: Actor): void {
  if (can(ctx, actor, "site.view")) return;
  if (actor.kind === "guest") throw new UnauthenticatedError();
  throw new ForbiddenError("You cannot view this site.");
}

/**
 * Whether the Guest group holds `site.view`. The public surfaces that are not asked by a viewer
 * (Atom feeds, sitemaps, llms.txt, the IndexNow announcements) serve what a guest may read, so
 * they serve nothing when guests may not open the site.
 */
export function siteOpenToGuests(ctx: Ctx): boolean {
  return can(ctx, GUEST, "site.view");
}

/** For a public surface with nothing to serve: not found when guests may not open the site. */
export function requireSiteOpenToGuests(ctx: Ctx): void {
  if (!siteOpenToGuests(ctx)) throw new NotFoundError();
}

/**
 * `requireSiteView` for reading member cards: a member's own card is always theirs to read, so the
 * page around a viewer who may not open the site (their menu, their settings) can still be drawn.
 */
export function requireSiteViewForCards(ctx: Ctx, actor: Actor, ids: readonly number[]): void {
  if (actor.kind !== "guest" && ids.every((id) => id === actor.userId)) return;
  requireSiteView(ctx, actor);
}
