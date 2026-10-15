import type { Ctx } from "../../context";
import { writeTx } from "../../db/tx";
import { type DomainEvent, registerEventSubscriber } from "../../events";
import {
  afterAwardGrant,
  type Facts,
  isRefreshedBy,
  loadFacts,
  membersAffected,
  evaluate as ruleHolds,
} from "../../shared/criteria";
import { type ClaimedJob, completeRunningJob, enqueueJob, registerJobHandler } from "../jobs/queue";
import { grantAward } from "./grants";
import { type AwardRow, all, awardSql, one, ruleOf, type TotalRow } from "./store";

// Granting can append several ledger and event rows per award; keep each lock brief.
export const SWEEP_CHUNK = 50;
type MemberRow = { id: number };
export const evaluationSql = {
  member: "SELECT id FROM users WHERE id = ?1",
  members: "SELECT id FROM users WHERE id > ?1 ORDER BY id LIMIT ?2",
  totals: "SELECT * FROM member_award_totals WHERE user_id IN (SELECT value FROM json_each(?1))",
};

/** The active awards with conditions: one with none is granted by hand only, whatever an empty rule means elsewhere. */
function activePlans(ctx: Ctx) {
  return all<AwardRow>(ctx, "catalog", awardSql.catalog)
    .filter((award) => award.is_active)
    .map((award) => ({ award, rule: ruleOf(award) }))
    .filter((plan) => plan.rule.conditions.length > 0);
}

type Plans = ReturnType<typeof activePlans>;

/**
 * The facts a pass reads from history take as long as that history is, so they are loaded before
 * the write begins; the transaction then reads what it changes (the awards, what each member
 * holds) and grants. An award edited since (another rule string, or no longer active) is left for
 * the next pass: the facts loaded were not the ones its rule needs.
 */
function readFacts(ctx: Ctx, memberIds: number[], seen: Plans) {
  return seen.length === 0 || memberIds.length === 0
    ? new Map<number, Facts>()
    : loadFacts(
        ctx,
        memberIds,
        seen.map((plan) => plan.rule),
      );
}
function confirmed(ctx: Ctx, seen: Plans): Plans {
  const rules = new Map(seen.map((plan) => [plan.award.id, plan.award.rule]));
  return activePlans(ctx).filter((plan) => rules.get(plan.award.id) === plan.award.rule);
}

function evaluate(ctx: Ctx, members: MemberRow[], plans: Plans, facts: Map<number, Facts>): number {
  if (plans.length === 0 || members.length === 0) return 0;
  const totals = all<TotalRow>(
    ctx,
    "evaluationTotals",
    evaluationSql.totals,
    JSON.stringify(members.map((m) => m.id)),
  );
  const byMember = new Map(totals.map((row) => [`${row.user_id}:${row.award_id}`, row]));
  let granted = 0;
  for (const member of members) {
    // A member who joined after the facts were read waits for the next pass.
    const memberFacts = facts.get(member.id);
    if (!memberFacts) continue;
    for (const { award, rule } of plans) {
      const total = byMember.get(`${member.id}:${award.id}`);
      if (total?.auto_granted || (!award.is_stackable && (total?.count ?? 0) > 0)) continue;
      if (!ruleHolds(rule, memberFacts)) continue;
      if (grantAward(ctx, award, member.id, null, "")) {
        granted++;
        // Later criteria in this transaction see the credits just paid and the award itself.
        afterAwardGrant(memberFacts, award);
      }
    }
  }
  return granted;
}

export function evaluateMember(ctx: Ctx, userId: number): number {
  // With no automatic award there is nothing to look up (this runs after most activity).
  const seen = activePlans(ctx);
  if (seen.length === 0) return 0;
  const facts = readFacts(ctx, [userId], seen);
  return writeTx(ctx, () => {
    const member = one<MemberRow>(ctx, "evaluationMember", evaluationSql.member, userId);
    return member ? evaluate(ctx, [member], confirmed(ctx, seen), facts) : 0;
  });
}

/**
 * Evaluates one page of members. Run by the queue (`job` given), the chunk commits together with
 * the job's completion and its successor; a run that no longer owns the job does nothing.
 */
export function sweepChunk(ctx: Ctx, after = 0, job?: ClaimedJob): number {
  if (!Number.isSafeInteger(after) || after < 0)
    throw new TypeError("Invalid award sweep progress.");
  const page = () =>
    all<MemberRow>(ctx, "evaluationMembers", evaluationSql.members, after, SWEEP_CHUNK);
  const seen = activePlans(ctx);
  const facts = readFacts(
    ctx,
    page().map((m) => m.id),
    seen,
  );
  return writeTx(ctx, () => {
    if (job && !completeRunningJob(ctx, job)) return 0;
    const members = page();
    evaluate(ctx, members, confirmed(ctx, seen), facts);
    if (members.length === SWEEP_CHUNK) {
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
  if (
    event.type === "member.groups_changed" &&
    (event.payload.source === "admin" ||
      event.payload.source === "verification" ||
      event.payload.source === "shop")
  )
    userId = event.targetId;
  const members = new Set(userId === null ? [] : [userId]);
  if (isRefreshedBy(event))
    for (const id of membersAffected(
      ctx,
      event,
      activePlans(ctx).map((plan) => plan.rule),
    ))
      members.add(id);
  for (const id of members) evaluateMember(ctx, id);
}

export function registerAwardJobs(ctx: Ctx): void {
  registerJobHandler(ctx, "awards.sweep", (context, payload, job) => {
    sweepChunk(context, (payload as { after: number }).after, job);
  });
  registerEventSubscriber(ctx, "awards", (event) => onEvent(ctx, event));
}
