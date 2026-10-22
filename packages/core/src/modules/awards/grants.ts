import type { Ctx } from "../../context";
import { ConflictError, NotFoundError } from "../../errors";
import { publishEvent } from "../../events";
import { moveCredits } from "../../shared/credits";
import { UNQUALIFIED_SOURCE } from "./revoke-events";
import { type AwardRow, awardSql, type GrantRow, one, run } from "./store";

export const claimSql =
  "INSERT INTO member_award_totals (user_id, award_id, count, auto_granted, last_granted_at) VALUES (?1, ?2, 1, ?3, ?4) " +
  "ON CONFLICT(user_id, award_id) DO UPDATE SET count = count + 1, auto_granted = max(auto_granted, excluded.auto_granted), last_granted_at = excluded.last_granted_at " +
  "WHERE (?5 = 1 OR count = 0) AND (?3 = 0 OR auto_granted = 0)";

/** The award and member must have been loaded in this same write transaction. */
export function grantAward(
  ctx: Ctx,
  award: AwardRow,
  userId: number,
  actorId: number | null,
  reason: string,
): GrantRow | null {
  if (!ctx.sqlite.inTransaction) throw new Error("Award grants require a write transaction.");
  if (!award.is_active) throw new ConflictError("The award is inactive.");
  const automatic = actorId === null;
  const now = ctx.now();
  const claimed = run(
    ctx,
    "claim",
    claimSql,
    userId,
    award.id,
    Number(automatic),
    now,
    award.is_stackable,
  );
  if (!claimed.changes) {
    if (automatic) return null;
    throw new ConflictError("The member already holds this award.");
  }
  const grant = one<GrantRow>(
    ctx,
    "insertGrant",
    "INSERT INTO member_awards (user_id, award_id, granted_by, reason, xp, credits, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING *",
    userId,
    award.id,
    actorId,
    reason,
    award.xp,
    award.credits,
    now,
  )!;
  run(
    ctx,
    "addXp",
    "UPDATE users SET award_xp = award_xp + ?1, award_count = award_count + 1 WHERE id = ?2",
    award.xp,
    userId,
  );
  run(ctx, "addCount", "UPDATE awards SET grant_count = grant_count + 1 WHERE id = ?1", award.id);
  if (award.credits > 0)
    moveCredits(ctx, [
      {
        userId,
        amount: award.credits,
        type: "award",
        source: { type: "member_award", id: grant.id },
        actorId,
        reason,
      },
    ]);
  publishEvent(ctx, {
    type: "award.granted",
    targetType: "user",
    targetId: userId,
    payload: {
      memberAwardId: grant.id,
      awardId: award.id,
      xp: award.xp,
      credits: award.credits,
      actorId,
      reason,
    },
  });
  return grant;
}

/**
 * Takes one grant back. A grant the criteria made stays marked as made (`auto_granted`), so the
 * criteria do not give it again. `unqualified` is for the run that takes grants back from members
 * who no longer meet the rule: it clears the mark (they get the award again if they come to meet
 * the rule) and marks the events and the credits row as the run's (`revoke-events.ts`).
 */
export function revokeAward(
  ctx: Ctx,
  id: number,
  actorId: number,
  reason: string,
  options: { unqualified?: boolean } = {},
): void {
  const unqualified = options.unqualified ?? false;
  if (!ctx.sqlite.inTransaction) throw new Error("Award revocations require a write transaction.");
  const grant = one<GrantRow>(ctx, "revoke", awardSql.revoke, ctx.now(), actorId, id);
  if (!grant) throw new NotFoundError();
  run(
    ctx,
    "removeTotal",
    "UPDATE member_award_totals SET count = count - 1, auto_granted = auto_granted AND NOT ?3 WHERE user_id = ?1 AND award_id = ?2",
    grant.user_id,
    grant.award_id,
    Number(unqualified),
  );
  run(
    ctx,
    "removeXp",
    "UPDATE users SET award_xp = award_xp - ?1, award_count = max(award_count - 1, 0) WHERE id = ?2",
    grant.xp,
    grant.user_id,
  );
  run(
    ctx,
    "removeCount",
    "UPDATE awards SET grant_count = grant_count - 1 WHERE id = ?1",
    grant.award_id,
  );
  if (grant.credits > 0)
    moveCredits(ctx, [
      {
        userId: grant.user_id,
        amount: -grant.credits,
        type: "award_revoked",
        source: { type: unqualified ? UNQUALIFIED_SOURCE : "member_award", id },
        actorId,
        reason,
      },
    ]);
  publishEvent(ctx, {
    type: "award.revoked",
    targetType: "user",
    targetId: grant.user_id,
    payload: {
      memberAwardId: id,
      awardId: grant.award_id,
      xp: grant.xp,
      credits: grant.credits,
      actorId,
      reason,
      ...(unqualified && { unqualified }),
    },
  });
}
