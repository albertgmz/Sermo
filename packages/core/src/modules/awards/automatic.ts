import type { Ctx } from "../../context";
import { writeTx } from "../../db/tx";
import { type DomainEvent, registerEventSubscriber } from "../../events";
import {
  attachPurchasedItems,
  CRITERIA_USER_COLUMNS,
  eligible,
  type MemberFacts,
} from "../../shared/criteria";
import { enqueueJob, registerJobHandler } from "../jobs/queue";
import { grantAward } from "./grants";
import { type AwardRow, all, awardSql, conditions, one, run, type TotalRow } from "./store";

// Granting can append several ledger and event rows per award; keep each lock brief.
export const SWEEP_CHUNK = 50;
type MemberRow = MemberFacts & { id: number };
export const evaluationSql = {
  member: `SELECT u.id, ${CRITERIA_USER_COLUMNS}, a.email_verified, coalesce((SELECT sum(w.points) FROM warnings w WHERE w.user_id = u.id AND (w.expires_at IS NULL OR w.expires_at > ?2)), 0) AS warning_points FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1`,
  members: `SELECT u.id, ${CRITERIA_USER_COLUMNS}, a.email_verified, 0 AS warning_points FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id > ?1 ORDER BY u.id LIMIT ?2`,
  warnings:
    "SELECT user_id, sum(points) AS points FROM warnings WHERE user_id IN (SELECT value FROM json_each(?1)) AND (expires_at IS NULL OR expires_at > ?2) GROUP BY user_id",
  totals: "SELECT * FROM member_award_totals WHERE user_id IN (SELECT value FROM json_each(?1))",
  releaseKey:
    "UPDATE jobs SET unique_key = NULL WHERE unique_key = 'awards.sweep' AND status = 'running'",
};

function evaluate(ctx: Ctx, members: MemberRow[]): number {
  const plans = all<AwardRow>(ctx, "catalog", awardSql.catalog)
    .filter((award) => award.is_active)
    .map((award) => ({ award, tests: conditions(award) }))
    .filter((plan) => plan.tests.length > 0);
  if (plans.length === 0 || members.length === 0) return 0;
  attachPurchasedItems(
    ctx,
    members,
    plans.map((plan) => plan.tests),
  );
  const totals = all<TotalRow>(
    ctx,
    "evaluationTotals",
    evaluationSql.totals,
    JSON.stringify(members.map((m) => m.id)),
  );
  const byMember = new Map(totals.map((row) => [`${row.user_id}:${row.award_id}`, row]));
  const now = ctx.now();
  let granted = 0;
  for (const member of members) {
    for (const { award, tests } of plans) {
      const total = byMember.get(`${member.id}:${award.id}`);
      if (total?.auto_granted || (!award.is_stackable && (total?.count ?? 0) > 0)) continue;
      if (!eligible(member, tests, now)) continue;
      if (grantAward(ctx, award, member.id, null, "")) {
        granted++;
        // Later criteria in this transaction see the credits just paid.
        member.credits += award.credits;
      }
    }
  }
  return granted;
}

export function evaluateMember(ctx: Ctx, userId: number): number {
  return writeTx(ctx, () => {
    const member = one<MemberRow>(ctx, "evaluationMember", evaluationSql.member, userId, ctx.now());
    return member ? evaluate(ctx, [member]) : 0;
  });
}

export function sweepChunk(ctx: Ctx, after = 0): number {
  if (!Number.isSafeInteger(after) || after < 0)
    throw new TypeError("Invalid award sweep progress.");
  return writeTx(ctx, () => {
    const members = all<MemberRow>(
      ctx,
      "evaluationMembers",
      evaluationSql.members,
      after,
      SWEEP_CHUNK,
    );
    const warnings = all<{ user_id: number; points: number }>(
      ctx,
      "evaluationWarnings",
      evaluationSql.warnings,
      JSON.stringify(members.map((member) => member.id)),
      ctx.now(),
    );
    const points = new Map(warnings.map((row) => [row.user_id, row.points]));
    for (const member of members) member.warning_points = points.get(member.id) ?? 0;
    evaluate(ctx, members);
    if (members.length === SWEEP_CHUNK) {
      run(ctx, "releaseSweepKey", evaluationSql.releaseKey);
      enqueueJob(ctx, "awards.sweep", { after: members.at(-1)!.id }, { uniqueKey: "awards.sweep" });
    }
    return members.length;
  });
}

function onEvent(ctx: Ctx, event: DomainEvent): void {
  let userId: number | null = null;
  if (event.type === "content.created") {
    const table = new Map([
      ["post", "posts"],
      ["thread", "threads"],
      ["profile_post", "profile_posts"],
      ["profile_post_comment", "profile_post_comments"],
    ]).get(event.targetType);
    if (table)
      userId =
        one<{ user_id: number }>(
          ctx,
          `eventAuthor.${table}`,
          `SELECT user_id FROM ${table} WHERE id = ?1`,
          event.targetId,
        )?.user_id ?? null;
  }
  if (event.type === "reaction.added") userId = Number(event.payload.contentUserId) || null;
  if (event.type === "member.warned" || event.type === "credits.changed") userId = event.targetId;
  if (event.type === "shop.purchased") userId = Number(event.payload.buyerId) || null;
  if (event.type === "content.edited" && event.targetType === "profile") userId = event.targetId;
  if (event.type === "member.groups_changed" && event.payload.source === "admin")
    userId = event.targetId;
  if (userId !== null) evaluateMember(ctx, userId);
}

export function registerAwardJobs(ctx: Ctx): void {
  registerJobHandler(ctx, "awards.sweep", (context, payload) => {
    sweepChunk(context, (payload as { after: number }).after);
  });
  registerEventSubscriber(ctx, "awards", (event) => onEvent(ctx, event));
}
