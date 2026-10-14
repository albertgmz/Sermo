import { requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { usersSetSuperAdmin } from "../../contracts/admin";
import { writeTx } from "../../db/tx";
import { ConflictError } from "../../errors";
import { implement } from "../../operation";
import { currentActor, requirePermission, requireSuperAdmin } from "../../permissions";
import { appendModeratorLog } from "../moderation";
import { confirmActorPassword, requireNotErased, targetMember } from "./shared";

/** Whether the member holds the flag now (read inside the caller's write transaction). */
export function isSuperAdminRow(ctx: Ctx, userId: number): boolean {
  return !!prepared(ctx, "admin.superAdminRow", () =>
    ctx.sqlite.prepare<{ id: number }, [number]>(
      "SELECT id FROM users WHERE id = ?1 AND is_super_admin = 1",
    ),
  ).get(userId);
}

/** Throws ConflictError unless a super admin other than `userId` exists whose account is not erased. */
export function assertOtherSuperAdmin(ctx: Ctx, userId: number): void {
  const other = prepared(ctx, "admin.otherSuperAdmin", () =>
    ctx.sqlite.prepare<{ id: number }, [number]>(
      "SELECT id FROM users WHERE is_super_admin = 1 AND erased_at IS NULL AND id != ?1 LIMIT 1",
    ),
  ).get(userId);
  if (!other) throw new ConflictError("Cannot remove the last super admin.");
}

export const usersSetSuperAdminOp = implement(usersSetSuperAdmin, async (ctx, actor, input) => {
  requireAuthenticated(actor);
  requireSuperAdmin(ctx, actor);
  requirePermission(ctx, actor, "admin.members", {
    target: targetMember(ctx, actor, input.userId),
  });
  await confirmActorPassword(ctx, actor, input.actorPassword);
  return writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    requireSuperAdmin(ctx, current);
    requirePermission(ctx, current, "admin.members", {
      target: targetMember(ctx, current, input.userId, true),
    });
    requireNotErased(ctx, input.userId);
    if (isSuperAdminRow(ctx, input.userId) === input.superAdmin) return { ok: true as const };
    if (!input.superAdmin) assertOtherSuperAdmin(ctx, input.userId);
    ctx.sqlite
      .prepare("UPDATE users SET is_super_admin = ?1 WHERE id = ?2")
      .run(Number(input.superAdmin), input.userId);
    appendModeratorLog(ctx, actor, "user.superAdmin", "user", input.userId, "", {
      superAdmin: input.superAdmin,
    });
    return { ok: true as const };
  });
});
