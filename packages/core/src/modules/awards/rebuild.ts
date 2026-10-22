import type * as z from "zod";
import type { Ctx } from "../../context";
import type { AwardRebuildRun } from "../../contracts/awards";
import { holdCheckpoints, paceWal } from "../../db/checkpointer";
import { writeTx } from "../../db/tx";
import {
  creditsEarnedKeys,
  type Facts,
  loadFactsPaced,
  rereadMemberFacts,
} from "../../shared/criteria";
import { levelFor } from "../../shared/levels";
import { iso, isoOrNull } from "../../time";
import { type ClaimedJob, completeRunningJob, enqueueJob, registerJobHandler } from "../jobs/queue";
import { readSiteSettings } from "../settings";
import { activePlans, confirmed, evaluate, nextTurn } from "./automatic";
import { type HeldGrant, heldBy, judge, mayManage } from "./revoke";
import { all, one, run } from "./store";

/** The queue's job and the key that lets one run be under way at a time. */
export const REBUILD_JOB = "awards.rebuild";
/** The settings row that holds the run's progress and totals. */
const RECORD_KEY = "awards.rebuild";
/** Members taken in order per chunk. */
export const REBUILD_CHUNK = 25;
/**
 * A chunk's transaction ends with the member that takes its grants and revocations to this many
 * (one member always, whatever they need): each is a dozen statements and two events.
 */
export const REBUILD_BUDGET = 100;

type RunRecord = {
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
  xpCorrected: number;
  levelsChanged: number;
  granted: number;
  takenBack: number;
  error: string | null;
};

export const rebuildSql = {
  members: "SELECT id, award_xp FROM users WHERE id > ?1 ORDER BY id LIMIT ?2",
  top: "SELECT max(id) AS id FROM users",
  // The grants a member holds are the source of truth for both counters (the economy invariant).
  correct:
    "UPDATE users SET " +
    "award_xp = (SELECT COALESCE(SUM(g.xp), 0) FROM member_awards g WHERE g.user_id = users.id AND g.revoked_at IS NULL), " +
    "award_count = (SELECT COUNT(*) FROM member_awards g WHERE g.user_id = users.id AND g.revoked_at IS NULL) " +
    "WHERE id IN (SELECT value FROM json_each(?1)) AND (" +
    "award_xp != (SELECT COALESCE(SUM(g.xp), 0) FROM member_awards g WHERE g.user_id = users.id AND g.revoked_at IS NULL) OR " +
    "award_count != (SELECT COUNT(*) FROM member_awards g WHERE g.user_id = users.id AND g.revoked_at IS NULL)) RETURNING id",
  xp: "SELECT award_xp FROM users WHERE id = ?1",
  record: `SELECT value FROM site_settings WHERE key = '${RECORD_KEY}'`,
  setRecord: `INSERT INTO site_settings (key, value, updated_at) VALUES ('${RECORD_KEY}', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  log: "INSERT INTO moderator_log (actor_id, action, target_type, target_id, reason, details, created_at, node_id) VALUES (?1, ?2, 'awards', 0, '', ?3, ?4, NULL)",
};

function readRecord(ctx: Ctx): RunRecord | null {
  const row = one<{ value: string }>(ctx, "rebuildRecord", rebuildSql.record);
  return row ? (JSON.parse(row.value) as RunRecord) : null;
}
function writeRecord(ctx: Ctx, record: RunRecord): void {
  run(ctx, "rebuildSetRecord", rebuildSql.setRecord, JSON.stringify(record), ctx.now());
}
/** The administrator's trail: the start and the end of a run, with its totals. */
function logRun(ctx: Ctx, record: RunRecord, action: string, details: object): void {
  run(ctx, "rebuildLog", rebuildSql.log, record.by, action, JSON.stringify(details), ctx.now());
}
const totalsOf = (record: RunRecord) => ({
  members: record.members,
  xpCorrected: record.xpCorrected,
  levelsChanged: record.levelsChanged,
  granted: record.granted,
  takenBack: record.takenBack,
});

/**
 * Starts a run, or resumes the one that stopped on an error. Returns false, changing nothing,
 * when a run is under way. Call it in a write transaction.
 */
export function startRebuild(ctx: Ctx, adminId: number): boolean {
  const previous = readRecord(ctx);
  const resumed = previous !== null && previous.state !== "done";
  const after = resumed ? previous.after : 0;
  if (enqueueJob(ctx, REBUILD_JOB, { after }, { uniqueKey: REBUILD_JOB }) === null) return false;
  const record: RunRecord = resumed
    ? { ...previous, state: "running", by: adminId, error: null }
    : {
        state: "running",
        by: adminId,
        startedAt: ctx.now(),
        finishedAt: null,
        after: 0,
        through: one<{ id: number | null }>(ctx, "rebuildTop", rebuildSql.top)?.id ?? 0,
        members: 0,
        xpCorrected: 0,
        levelsChanged: 0,
        granted: 0,
        takenBack: 0,
        error: null,
      };
  writeRecord(ctx, record);
  logRun(ctx, record, "awards.rebuild.start", { resumed });
  return true;
}

/**
 * The administrator a run started from outside the web app acts as: `requested` when that member
 * holds `admin.awards`, else the lowest-numbered member who does among the first hundred; null
 * when there is none.
 */
export function rebuildAdministrator(ctx: Ctx, requested?: number): number | null {
  const candidates =
    requested === undefined
      ? all<{ id: number }>(ctx, "rebuildAdmins", "SELECT id FROM users ORDER BY id LIMIT 100").map(
          (row) => row.id,
        )
      : [requested];
  return writeTx(ctx, () => candidates.find((id) => mayManage(ctx, id)) ?? null);
}

/** The latest run as the contract returns it. */
export function rebuildRunValue(ctx: Ctx): z.infer<typeof AwardRebuildRun> {
  const record = readRecord(ctx);
  if (!record)
    return {
      state: "idle",
      startedAt: null,
      finishedAt: null,
      progress: 0,
      members: 0,
      xpCorrected: 0,
      levelsChanged: 0,
      granted: 0,
      takenBack: 0,
      error: null,
    };
  return {
    state: record.state,
    startedAt: iso(record.startedAt),
    finishedAt: isoOrNull(record.finishedAt),
    progress:
      record.state === "done" || record.through <= 0
        ? Number(record.state === "done")
        : Math.min(1, record.after / record.through),
    ...totalsOf(record),
    error: record.error,
  };
}

/** Ends the run as failed, in the transaction that completes its job: starting it again resumes it. */
function stop(ctx: Ctx, record: RunRecord, error: string): void {
  record.state = "failed";
  record.error = error;
  writeRecord(ctx, record);
  logRun(ctx, record, "awards.rebuild.failed", { error });
}

/**
 * Rebuilds one page of members. The facts are read first, a statement at a time with a turn of
 * the event loop after each; then one transaction, which commits together with the job's
 * completion and its successor, sets each member's XP and award count to what their grants add
 * up to, takes back the automatic grants they no longer qualify for (as `revoke.ts` does) and
 * grants the automatic awards they qualify for (as the sweep does). A run that no longer owns the
 * job, or that is not the one the record describes, does nothing.
 */
export async function rebuildChunk(ctx: Ctx, after: number, job: ClaimedJob): Promise<void> {
  if (!Number.isSafeInteger(after) || after < 0)
    throw new TypeError("Invalid award rebuild progress.");
  const page = all<{ id: number; award_xp: number }>(
    ctx,
    "rebuildMembers",
    rebuildSql.members,
    after,
    REBUILD_CHUNK,
  );
  const ids = page.map((row) => row.id);
  const seen = activePlans(ctx);
  const facts =
    seen.length === 0 || ids.length === 0
      ? new Map<number, Facts>()
      : await loadFactsPaced(
          ctx,
          ids,
          seen.map((plan) => plan.rule),
          nextTurn,
        );
  await paceWal(ctx);
  const release = holdCheckpoints(ctx);
  try {
    writeTx(ctx, () => {
      if (!completeRunningJob(ctx, job)) return;
      const record = readRecord(ctx);
      if (record?.state !== "running") return;
      // A run the record does not describe would otherwise leave it "running" for ever.
      if (record.after !== after) return stop(ctx, record, "The run does not match its record.");
      if (!mayManage(ctx, record.by))
        return stop(
          ctx,
          record,
          "The administrator who started the run can no longer manage awards.",
        );
      const plans = confirmed(ctx, seen);
      const rules = plans.map((plan) => plan.rule);
      const step = readSiteSettings(ctx).levelStep;
      const wrong = new Set(
        all<{ id: number }>(ctx, "rebuildCorrect", rebuildSql.correct, JSON.stringify(ids)).map(
          (row) => row.id,
        ),
      );
      rereadMemberFacts(ctx, facts, rules);
      const byAward = new Map(plans.map((plan) => [plan.award.id, plan]));
      const earned = creditsEarnedKeys(rules);
      const held = new Map<number, HeldGrant[]>();
      for (const grant of heldBy(ctx, ids))
        held.set(grant.user_id, [...(held.get(grant.user_id) ?? []), grant]);
      let work = 0;
      let last = after;
      for (const { id, award_xp } of page) {
        if (last !== after && work >= REBUILD_BUDGET) break;
        const memberFacts = facts.get(id);
        const taken = memberFacts
          ? judge(ctx, held.get(id) ?? [], byAward, memberFacts, earned, record.by)
          : [];
        const { granted } = evaluate(ctx, [{ id }], plans, facts);
        work += taken.length + granted;
        record.takenBack += taken.length;
        record.granted += granted;
        record.members++;
        if (wrong.has(id)) record.xpCorrected++;
        const now = one<{ award_xp: number }>(ctx, "rebuildXp", rebuildSql.xp, id)!.award_xp;
        if (levelFor(award_xp, step).level !== levelFor(now, step).level) record.levelsChanged++;
        last = id;
      }
      record.after = last;
      if (last < (ids.at(-1) ?? 0) || ids.length === REBUILD_CHUNK)
        enqueueJob(ctx, REBUILD_JOB, { after: last }, { uniqueKey: REBUILD_JOB });
      else {
        record.state = "done";
        record.finishedAt = ctx.now();
        logRun(ctx, record, "awards.rebuild.done", totalsOf(record));
      }
      writeRecord(ctx, record);
    });
  } finally {
    release();
  }
}

export function registerRebuildJobs(ctx: Ctx): void {
  registerJobHandler(
    ctx,
    REBUILD_JOB,
    async (context, payload, job) => {
      await rebuildChunk(context, (payload as { after: number }).after, job);
    },
    {
      holdCheckpoints: false,
      // The run stays where it stopped; calling it again resumes it.
      onFailed: (context, { error }) => {
        const record = readRecord(context);
        if (record?.state === "running") stop(context, record, error);
      },
    },
  );
}
