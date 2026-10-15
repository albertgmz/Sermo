import type { Actor } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { can, permissionValue } from "../../permissions";

const DAY = 86_400_000;

export interface RenameStanding {
  /** Why the member may not change their username now; null when they may. */
  reason: "approval" | "limit" | null;
  /** When the limit frees a change, epoch ms; null when it does not (or no limit applies). */
  availableAt: number | null;
}

/**
 * Whether a member may change their own username now, by the permissions alone (a shop unit or
 * `profile.renameFree` is a separate matter): `profile.renameNeedsApproval` refuses outright, and
 * `profile.renameLimit` changes within the last `profile.renameWindowDays` days (0 or -1: ever)
 * refuse once used up. Reads at most `profile.renameLimit` rows of the member's own changes.
 */
export function renameStanding(ctx: Ctx, actor: Actor, userId: number): RenameStanding {
  if (can(ctx, actor, "profile.renameNeedsApproval"))
    return { reason: "approval", availableAt: null };
  const limit = permissionValue(ctx, actor, "profile.renameLimit");
  if (limit <= 0) return { reason: null, availableAt: null };
  const days = permissionValue(ctx, actor, "profile.renameWindowDays");
  const since = days > 0 ? ctx.now() - days * DAY : 0;
  const recent = prepared(ctx, "auth.recentRenames", () =>
    ctx.sqlite.prepare<{ changed_at: number }, [number, number, number]>(
      "SELECT changed_at FROM username_changes WHERE user_id = ?1 AND changed_at > ?2 ORDER BY changed_at DESC LIMIT ?3",
    ),
  ).all(userId, since, limit);
  if (recent.length < limit) return { reason: null, availableAt: null };
  return {
    reason: "limit",
    availableAt: days > 0 ? recent[limit - 1]!.changed_at + days * DAY : null,
  };
}
