import type * as z from "zod";
import type { Ctx } from "../../context";
import type { AwardRevokeRun } from "../../contracts/awards";
import { holdCheckpoints, paceWal } from "../../db/checkpointer";
import { writeTx } from "../../db/tx";
import {
  creditsEarnedKeys,
  type Facts,
  loadFactsPaced,
  rereadMemberFacts,
  evaluate as ruleHolds,
} from "../../shared/criteria";
import { iso, isoOrNull } from "../../time";
import { type ClaimedJob, completeRunningJob, enqueueJob, registerJobHandler } from "../jobs/queue";
import { activePlans, confirmed, nextTurn, type Plans } from "./automatic";
import { revokeAward } from "./grants";
import { type AwardRow, all, awardSql, one, run } from "./store";

/** The queue's job and the key that lets one run be under way at a time. */
export const REVOKE_JOB = "awards.revoke";
/** The settings row that holds the run's progress and totals. */
const RECORD_KEY = "awards.revokeUnqualified";
/** Members taken from the grants in order per chunk. */
export const REVOKE_CHUNK = 25;
/**
 * A chunk's transaction takes members, in order, while the automatic grants they hold stay within
 * this many (one member always, whatever they hold): each revocation is a dozen statements and
 * two events, and the facts of the members are read for the whole chunk.
 */
export const REVOKE_BUDGET = 100;
/** What a revoked grant says about why. */
export const REVOKE_REASON = "The member no longer meets the rule of the award.";

type Mode = "count" | "revoke";
type RunRecord = {
  mode: Mode;
  state: "running" | "done" | "failed";
  /** The administrator who started it. */
  by: number;
  startedAt: number;
  finishedAt: number | null;
  /** The last member passed. */
  after: number;
  /** The highest member id when it started: how far there is to go. */
  through: number;
  members: number;
  affected: number;
  grants: number;
  xp: number;
  credits: number;
  byAward: { [awardId: string]: number };
  error: string | null;
};
type HeldGrant = { id: number; user_id: number; award_id: number; xp: number; credits: number };

export const revokeSql = {
  // Members with automatic grants in order: the member's held grants sit together in the index.
  members:
    "SELECT DISTINCT user_id FROM member_awards WHERE user_id > ?1 AND revoked_at IS NULL AND granted_by IS NULL ORDER BY user_id LIMIT ?2",
  grants:
    "SELECT id, user_id, award_id, xp, credits FROM member_awards WHERE user_id IN (SELECT value FROM json_each(?1)) AND revoked_at IS NULL AND granted_by IS NULL ORDER BY user_id, id",
  top: "SELECT max(id) AS id FROM users",
  record: `SELECT value FROM site_settings WHERE key = '${RECORD_KEY}'`,
  setRecord: `INSERT INTO site_settings (key, value, updated_at) VALUES ('${RECORD_KEY}', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  log: "INSERT INTO moderator_log (actor_id, action, target_type, target_id, reason, details, created_at, node_id) VALUES (?1, ?2, 'awards', 0, ?3, ?4, ?5, NULL)",
};

function readRecord(ctx: Ctx): RunRecord | null {
  const row = one<{ value: string }>(ctx, "revokeRecord", revokeSql.record);
  return row ? (JSON.parse(row.value) as RunRecord) : null;
}
function writeRecord(ctx: Ctx, record: RunRecord): void {
  run(ctx, "revokeSetRecord", revokeSql.setRecord, JSON.stringify(record), ctx.now());
}
/** The administrator's trail: the start and the end of a revoking run, with its totals. */
function logRun(ctx: Ctx, record: RunRecord, action: string, details: object): void {
  run(
    ctx,
    "revokeLog",
    revokeSql.log,
    record.by,
    action,
    "",
    JSON.stringify({ ...details, mode: record.mode }),
    ctx.now(),
  );
}

/**
 * Starts a run, or resumes the one that stopped on an error when it is the same mode. Returns
 * false, changing nothing, when a run is under way. Call it in a write transaction.
 */
export function startRevoke(ctx: Ctx, adminId: number, apply: boolean): boolean {
  const mode: Mode = apply ? "revoke" : "count";
  const previous = readRecord(ctx);
  const resumed = previous !== null && previous.state !== "done" && previous.mode === mode;
  const after = resumed ? previous.after : 0;
  if (enqueueJob(ctx, REVOKE_JOB, { after }, { uniqueKey: REVOKE_JOB }) === null) return false;
  const now = ctx.now();
  const record: RunRecord = resumed
    ? { ...previous, state: "running", by: adminId, error: null }
    : {
        mode,
        state: "running",
        by: adminId,
        startedAt: now,
        finishedAt: null,
        after: 0,
        through: one<{ id: number | null }>(ctx, "revokeTop", revokeSql.top)?.id ?? 0,
        members: 0,
        affected: 0,
        grants: 0,
        xp: 0,
        credits: 0,
        byAward: {},
        error: null,
      };
  writeRecord(ctx, record);
  if (apply) logRun(ctx, record, "awards.revokeUnqualified.start", { resumed });
  return true;
}

/** The latest run as the contract returns it. */
export function revokeRunValue(ctx: Ctx): z.infer<typeof AwardRevokeRun> {
  const record = readRecord(ctx);
  if (!record)
    return {
      state: "idle",
      mode: null,
      startedAt: null,
      finishedAt: null,
      progress: 0,
      members: 0,
      affectedMembers: 0,
      grants: 0,
      xp: 0,
      credits: 0,
      awards: [],
      error: null,
    };
  const names = new Map(all<AwardRow>(ctx, "catalog", awardSql.catalog).map((a) => [a.id, a.name]));
  return {
    state: record.state,
    mode: record.mode,
    startedAt: iso(record.startedAt),
    finishedAt: isoOrNull(record.finishedAt),
    progress:
      record.state === "done" || record.through <= 0
        ? Number(record.state === "done")
        : Math.min(1, record.after / record.through),
    members: record.members,
    affectedMembers: record.affected,
    grants: record.grants,
    xp: record.xp,
    credits: record.credits,
    awards: Object.entries(record.byAward)
      .map(([awardId, grants]) => ({
        awardId: Number(awardId),
        name: names.get(Number(awardId)) ?? "",
        grants,
      }))
      .sort((a, b) => b.grants - a.grants || a.awardId - b.awardId),
    error: record.error,
  };
}

/**
 * The facts a grant gave, taken out of the facts a pass is judging: the inverse of
 * `afterAwardGrant`, so the awards judged after it see what the member is left with.
 */
function afterRevoke(facts: Facts, grant: HeldGrant, earned: ReadonlySet<string>): void {
  facts.credits -= grant.credits;
  facts.awardXp -= grant.xp;
  facts.awardCount = Math.max(0, facts.awardCount - 1);
  for (const key of earned)
    facts.measures.set(key, Number(facts.measures.get(key) ?? 0) - grant.credits);
  for (const [key, measure] of facts.measures) {
    const [criterion, ids] = key.split("|");
    if (criterion !== "holds_awards" || !(measure instanceof Map)) continue;
    if (ids?.split(",").includes(String(grant.award_id)))
      measure.set(grant.award_id, Math.max(0, (measure.get(grant.award_id) ?? 0) - 1));
  }
}

/**
 * The grants of one member whose rule they no longer meet, judged again until none more falls: an
 * award that needs XP, credits or another award is judged with what the member is left with after
 * the ones taken back before it. With `apply` they are revoked; without it only counted.
 */
function judge(
  ctx: Ctx,
  held: HeldGrant[],
  plans: Map<number, Plans[number]>,
  facts: Facts,
  earned: ReadonlySet<string>,
  adminId: number | null,
): HeldGrant[] {
  const taken: HeldGrant[] = [];
  let left = held.filter((grant) => plans.has(grant.award_id));
  for (let again = true; again; ) {
    again = false;
    for (const grant of [...left]) {
      if (ruleHolds(plans.get(grant.award_id)!.rule, facts)) continue;
      left = left.filter((other) => other !== grant);
      if (adminId !== null) revokeAward(ctx, grant.id, adminId, REVOKE_REASON, { rearm: true });
      afterRevoke(facts, grant, earned);
      taken.push(grant);
      again = true;
    }
  }
  return taken;
}

function heldBy(ctx: Ctx, members: number[]): HeldGrant[] {
  return all<HeldGrant>(ctx, "revokeGrants", revokeSql.grants, JSON.stringify(members));
}

/** The members of a page one transaction takes: the grants they hold stay within `REVOKE_BUDGET`. */
function takeMembers(page: number[], grants: HeldGrant[]): number[] {
  const held = new Map<number, number>();
  for (const grant of grants) held.set(grant.user_id, (held.get(grant.user_id) ?? 0) + 1);
  const taken: number[] = [];
  let total = 0;
  for (const id of page) {
    const n = held.get(id) ?? 0;
    if (taken.length > 0 && total + n > REVOKE_BUDGET) break;
    taken.push(id);
    total += n;
  }
  return taken;
}

/**
 * Looks at one page of members who hold automatic grants, after `after`. The facts are read first,
 * a statement at a time with a turn of the event loop after each; then one transaction judges the
 * page again on the member's own rows, revokes (or only counts), adds to the run's totals, and
 * commits together with the job's completion and its successor. A run that no longer owns the job,
 * or that is not the one the record describes, does nothing.
 */
export async function revokeChunk(ctx: Ctx, after: number, job: ClaimedJob): Promise<void> {
  if (!Number.isSafeInteger(after) || after < 0)
    throw new TypeError("Invalid award revocation progress.");
  const page = all<{ user_id: number }>(
    ctx,
    "revokeMembers",
    revokeSql.members,
    after,
    REVOKE_CHUNK,
  ).map((row) => row.user_id);
  const pageGrants = heldBy(ctx, page);
  const members = takeMembers(page, pageGrants);
  const awardIds = new Set(pageGrants.map((grant) => grant.award_id));
  const seen = activePlans(ctx).filter((plan) => awardIds.has(plan.award.id));
  const facts =
    seen.length === 0 || members.length === 0
      ? new Map<number, Facts>()
      : await loadFactsPaced(
          ctx,
          members,
          seen.map((plan) => plan.rule),
          nextTurn,
        );
  await paceWal(ctx);
  const release = holdCheckpoints(ctx);
  try {
    writeTx(ctx, () => {
      if (!completeRunningJob(ctx, job)) return;
      const record = readRecord(ctx);
      if (record?.state !== "running" || record.after !== after) return;
      const plans = confirmed(ctx, seen);
      rereadMemberFacts(
        ctx,
        facts,
        plans.map((plan) => plan.rule),
      );
      const byAward = new Map(plans.map((plan) => [plan.award.id, plan]));
      const earned = creditsEarnedKeys(plans.map((plan) => plan.rule));
      const held = new Map<number, HeldGrant[]>();
      for (const grant of heldBy(ctx, members))
        held.set(grant.user_id, [...(held.get(grant.user_id) ?? []), grant]);
      const apply = record.mode === "revoke";
      for (const userId of members) {
        const memberFacts = facts.get(userId);
        const taken = memberFacts
          ? judge(
              ctx,
              held.get(userId) ?? [],
              byAward,
              memberFacts,
              earned,
              apply ? record.by : null,
            )
          : [];
        record.members++;
        if (taken.length > 0) record.affected++;
        for (const grant of taken) {
          record.grants++;
          record.xp += grant.xp;
          record.credits += grant.credits;
          record.byAward[grant.award_id] = (record.byAward[grant.award_id] ?? 0) + 1;
        }
      }
      record.after = members.at(-1) ?? after;
      if (page.length === REVOKE_CHUNK || members.length < page.length)
        enqueueJob(ctx, REVOKE_JOB, { after: record.after }, { uniqueKey: REVOKE_JOB });
      else {
        record.state = "done";
        record.finishedAt = ctx.now();
        if (apply)
          logRun(ctx, record, "awards.revokeUnqualified.done", {
            members: record.members,
            affected: record.affected,
            grants: record.grants,
            xp: record.xp,
            credits: record.credits,
            byAward: record.byAward,
          });
      }
      writeRecord(ctx, record);
    });
  } finally {
    release();
  }
}

export function registerRevokeJobs(ctx: Ctx): void {
  registerJobHandler(
    ctx,
    REVOKE_JOB,
    async (context, payload, job) => {
      await revokeChunk(context, (payload as { after: number }).after, job);
    },
    {
      holdCheckpoints: false,
      // The run stays where it stopped; calling it again with the same mode resumes it.
      onFailed: (context, { error }) => {
        const record = readRecord(context);
        if (record?.state !== "running") return;
        record.state = "failed";
        record.error = error;
        writeRecord(context, record);
        if (record.mode === "revoke")
          logRun(context, record, "awards.revokeUnqualified.failed", { error });
      },
    },
  );
}
