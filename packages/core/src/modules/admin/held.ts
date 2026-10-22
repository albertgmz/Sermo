import { type Actor, GUEST, requireAuthenticated } from "../../actor";
import type { Ctx } from "../../context";
import { ForbiddenError } from "../../errors";
import { requirePermission, resolvedPermissions } from "../../permissions";

/** Permissions that are otherwise checked against a member, whose bare grant is asked here. */
export type HeldPermission =
  | "admin.members"
  | "member.ban"
  | "member.editProfile"
  | "member.restrict"
  | "member.spamCleanup"
  | "member.viewIps";

/**
 * Whether the actor holds a permission (any of several) that is otherwise checked against a
 * member: a list of members or of bans has none, and an operation that cannot name its member
 * before it reads its input asks this first, so a caller who could never act is refused before
 * the input is looked at. The resolved permissions apply no member-dependent condition; the
 * check against the member itself still follows. A refusal is worded by the permission engine
 * (an account waiting for approval is told so). This relies on the guest group ranking below
 * every member, as `member.ban` always has.
 */
export function requireHeld(
  ctx: Ctx,
  actor: Actor,
  wanted: HeldPermission | readonly HeldPermission[],
): void {
  requireAuthenticated(actor);
  const ids = typeof wanted === "string" ? [wanted] : wanted;
  const held = resolvedPermissions(ctx, actor);
  if (ids.some((id) => held[id] === true)) return;
  requirePermission(ctx, actor, ids[0]!, { target: GUEST });
  throw new ForbiddenError();
}
