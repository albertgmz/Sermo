import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import { ForbiddenError, UnauthenticatedError } from "../../errors";
import { can } from "../../permissions";

/**
 * Refuses a viewer who lacks `site.view`: the entry points that read the site's
 * content (forums, threads, feeds, search, profiles, the member list) call this first. A guest
 * is asked to sign in, a member is told the site is closed to them.
 */
export function requireSiteView(ctx: Ctx, actor: Actor): void {
  if (can(ctx, actor, "site.view")) return;
  if (actor.kind === "guest") throw new UnauthenticatedError();
  throw new ForbiddenError("You cannot view this site.");
}
