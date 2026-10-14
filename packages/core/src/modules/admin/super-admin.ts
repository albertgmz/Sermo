import { GUEST, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { usersSetSuperAdmin } from "../../contracts/admin";
import { writeTx } from "../../db/tx";
import { ConflictError } from "../../errors";
import { implement } from "../../operation";
import {
  can,
  currentActor,
  currentVersions,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  requirePermission,
  requireSuperAdmin,
} from "../../permissions";
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

type Holder = PrincipalRow & { id: number; group_id: number };

/**
 * Whether a super admin other than `excluding` can still administer: their account is not erased
 * or banned and they hold `admin.members`. Read inside the caller's write transaction.
 */
export function usableSuperAdminExists(ctx: Ctx, excluding = 0): boolean {
  const holders = prepared(ctx, "admin.superAdmins", () =>
    ctx.sqlite.prepare<Holder, [number]>(
      `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.is_super_admin = 1 AND u.erased_at IS NULL AND u.id != ?1`,
    ),
  ).all(excluding);
  const versions = currentVersions(ctx);
  // `can` refuses a banned member before anything else.
  return holders.some((row) =>
    can(ctx, memberActor(row.id, row.group_id, row, versions), "admin.members", { target: GUEST }),
  );
}

/** Throws ConflictError unless a usable super admin other than `userId` exists. */
export function assertOtherSuperAdmin(ctx: Ctx, userId: number): void {
  if (!usableSuperAdminExists(ctx, userId))
    throw new ConflictError("Cannot remove the last super admin.");
}

/**
 * For a change that may take `admin.members` from a super admin: capture before it whether a
 * usable super admin exists, and call the returned check after it, in the same transaction.
 */
export function guardSuperAdmins(ctx: Ctx): () => void {
  const had = usableSuperAdminExists(ctx);
  return () => {
    if (had && !usableSuperAdminExists(ctx))
      throw new ConflictError("This would leave no usable super admin.");
  };
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
