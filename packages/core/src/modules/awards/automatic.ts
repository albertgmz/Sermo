import type { Ctx } from "../../context";
import { holdCheckpoints, paceWal } from "../../db/checkpointer";
import { writeTx } from "../../db/tx";
import { type DomainEvent, registerEventSubscriber } from "../../events";
import {
  afterAwardGrant,
  creditsEarnedKeys,
  type Facts,
  isRefreshedBy,
  loadFacts,
  loadFactsPaced,
  membersAffected,
  rereadMemberFacts,
  evaluate as ruleHolds,
} from "../../shared/criteria";
import { type ClaimedJob, completeRunningJob, enqueueJob, registerJobHandler } from "../jobs/queue";
import { grantAward } from "./grants";
import { type AwardRow, all, awardSql, one, ruleOf, type TotalRow } from "./store";

// Granting can append several ledger and event rows per award; keep each lock brief.
export const SWEEP_CHUNK = 50;
/**
 * A chunk's transaction ends with the member that takes its grants to this many, and the next
 * chunk starts after that member: the first pass after new awards gives some to nearly everyone.
 */
export const SWEEP_GRANTS = 100;
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

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

function confirmed(ctx: Ctx, seen: Plans): Plans {
  const rules = new Map(seen.map((plan) => [plan.award.id, plan.award.rule]));
  return activePlans(ctx).filter((plan) => rules.get(plan.award.id) === plan.award.rule);
}

/** Judges `members` in order until `budget` grants are made; says how many it judged. */
function evaluate(
  ctx: Ctx,
  members: MemberRow[],
  plans: Plans,
  facts: Map<number, Facts>,
  budget = Number.POSITIVE_INFINITY,
): { granted: number; judged: number } {
  if (plans.length === 0 || members.length === 0) return { granted: 0, judged: members.length };
  const totals = all<TotalRow>(
    ctx,
    "evaluationTotals",
    evaluationSql.totals,
    JSON.stringify(members.map((m) => m.id)),
  );
  const byMember = new Map(totals.map((row) => [`${row.user_id}:${row.award_id}`, row]));
  const earned = creditsEarnedKeys(plans.map((plan) => plan.rule));
  let granted = 0;
  let judged = 0;
  for (const member of members) {
    if (granted >= budget) break;
    judged++;
    // A member who joined after the facts were read waits for the next pass.
    const memberFacts = facts.get(member.id);
    if (!memberFacts) continue;
    const decided = new Set<number>();
    // Again until a round grants nothing: an award may need one that comes after it, and its
    // grant's own events are not judged again (`onEvent`).
    for (let round = true; round; ) {
      round = false;
      for (const { award, rule } of plans) {
        if (decided.has(award.id)) continue;
        const total = byMember.get(`${member.id}:${award.id}`);
        if (total?.auto_granted || (!award.is_stackable && (total?.count ?? 0) > 0)) continue;
        if (!ruleHolds(rule, memberFacts)) continue;
        decided.add(award.id);
        if (grantAward(ctx, award, member.id, null, "")) {
          granted++;
          round = true;
          // Later criteria in this transaction see the credits just paid and the award itself.
          afterAwardGrant(memberFacts, award, earned);
        }
      }
    }
  }
  return { granted, judged };
}

export function evaluateMember(ctx: Ctx, userId: number): number {
  // With no automatic award there is nothing to look up (this runs after most activity).
  const seen = activePlans(ctx);
  if (seen.length === 0) return 0;
  const facts = readFacts(ctx, [userId], seen);
  return writeTx(ctx, () => {
    const member = one<MemberRow>(ctx, "evaluationMember", evaluationSql.member, userId);
    return member ? evaluate(ctx, [member], confirmed(ctx, seen), facts).granted : 0;
  });
}

/**
 * Evaluates one page of members. Run by the queue (`job` given), the chunk commits together with
 * the job's completion and its successor; a run that no longer owns the job does nothing. The
 * facts are read a statement at a time with a turn of the event loop after each, so a page
 * against a hundred rules never holds the thread that serves requests for long.
 */
export async function sweepChunk(ctx: Ctx, after = 0, job?: ClaimedJob): Promise<number> {
  if (!Number.isSafeInteger(after) || after < 0)
    throw new TypeError("Invalid award sweep progress.");
  const page = () =>
    all<MemberRow>(ctx, "evaluationMembers", evaluationSql.members, after, SWEEP_CHUNK);
  const seen = activePlans(ctx);
  const memberIds = page().map((m) => m.id);
  const facts =
    seen.length === 0 || memberIds.length === 0
      ? new Map<number, Facts>()
      : await loadFactsPaced(
          ctx,
          memberIds,
          seen.map((plan) => plan.rule),
          nextTurn,
        );
  // Requests wrote while the facts were read: let a checkpoint restart a WAL grown past its
  // limit, and keep checkpoints off only while this chunk writes (the queue does not hold them
  // across the turns above).
  await paceWal(ctx);
  const release = holdCheckpoints(ctx);
  try {
    return writeTx(ctx, () => {
      if (job && !completeRunningJob(ctx, job)) return 0;
      const members = page();
      const plans = confirmed(ctx, seen);
      // The statements above ran at different moments; a grant rests on the member's row as it
      // is now (credits, counts, XP, restrictions) and on measures read moments ago.
      rereadMemberFacts(
        ctx,
        facts,
        plans.map((plan) => plan.rule),
      );
      const { judged } = evaluate(ctx, members, plans, facts, SWEEP_GRANTS);
      if (judged < members.length || members.length === SWEEP_CHUNK) {
        const next = members[judged - 1]!.id;
        enqueueJob(ctx, "awards.sweep", { after: next }, { uniqueKey: "awards.sweep" });
      }
      return judged;
    });
  } finally {
    release();
  }
}

const AGAIN = "awards.sweep.again";
const sweepQueued = (ctx: Ctx) =>
  one<{ id: number }>(ctx, "sweepQueued", "SELECT id FROM jobs WHERE unique_key = 'awards.sweep'");

/**
 * Called in the transaction that creates or changes an automatic award. A sweep under way has
 * already passed some members, and passes the rest with the facts it read for the old rules; a
 * fresh sweep from the first member is queued for when it ends.
 */
export function sweepAgainAfterCurrent(ctx: Ctx): void {
  if (sweepQueued(ctx)) enqueueJob(ctx, AGAIN, {}, { uniqueKey: AGAIN });
}

function onEvent(ctx: Ctx, event: DomainEvent): void {
  // An automatic grant, and the credits it paid, come from a pass that judged every award again
  // with them (`evaluate`): they leave nothing to change.
  if (
    event.payload.actorId === null &&
    (event.type === "award.granted" ||
      (event.type === "credits.changed" && event.payload.type === "award"))
  )
    return;
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
  registerJobHandler(
    ctx,
    "awards.sweep",
    async (context, payload, job) => {
      await sweepChunk(context, (payload as { after: number }).after, job);
    },
    { holdCheckpoints: false },
  );
  // Waits for the sweep under way, looking again every half minute, then starts a fresh one.
  registerJobHandler(ctx, AGAIN, (context, _payload, job) => {
    writeTx(context, () => {
      if (!completeRunningJob(context, job)) return;
      if (sweepQueued(context))
        enqueueJob(context, AGAIN, {}, { uniqueKey: AGAIN, runAt: context.now() + 30_000 });
      else enqueueJob(context, "awards.sweep", { after: 0 }, { uniqueKey: "awards.sweep" });
    });
  });
  // A turn of the event loop after each event: a batch of them is consumed back to back, and the
  // first pass after new awards publishes one or two for each grant.
  registerEventSubscriber(ctx, "awards", async (event) => {
    onEvent(ctx, event);
    await nextTurn();
  });
}
