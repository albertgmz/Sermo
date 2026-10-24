import { requireAuthenticated } from "../../actor";
import type { Ctx } from "../../context";
import { usersDeleteOwnAccount } from "../../contracts/admin";
import { ConflictError } from "../../errors";
import { implement } from "../../operation";
import { requirePermission } from "../../permissions";
import { eraseMember } from "./erase";
import { startKeepingContent } from "./keep-content";
import { verifyActorPassword } from "./shared";
import { isSuperAdminRow } from "./super-admin";

/** The flag is the owner's seat: it is handed on by another super admin, never dropped by erasing. */
function refuseSuperAdmin(ctx: Ctx, userId: number): void {
  if (isSuperAdminRow(ctx, userId))
    throw new ConflictError(
      "A super admin cannot delete their own account. Hand the flag on to another super admin first.",
    );
}

/**
 * A member closes their own account. The erasure is the administrators' one (`eraseMember`), so
 * the account ends up marked erased and banned for good exactly as that path leaves it; what they
 * wrote stays, as a guest's (`keep-content.ts`). The
 * permission and the super admin rule are decided before the password is asked for and again
 * inside the first transaction; the last-administrator rule is the ban's own, which the same
 * transaction runs.
 */
export const usersDeleteOwnAccountOp = implement(
  usersDeleteOwnAccount,
  async (ctx, actor, input) => {
    const { userId } = requireAuthenticated(actor);
    requirePermission(ctx, actor, "profile.deleteAccount");
    refuseSuperAdmin(ctx, userId);
    await verifyActorPassword(ctx, actor, input.password, "password");
    await eraseMember(ctx, actor, userId, "Deleted by the member", (current) => {
      requirePermission(ctx, current, "profile.deleteAccount");
      refuseSuperAdmin(ctx, userId);
    });
    startKeepingContent(ctx, userId);
    return { ok: true as const };
  },
);
