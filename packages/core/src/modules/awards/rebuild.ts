import type * as z from "zod";
import type { Ctx } from "../../context";
import type { AwardRebuildRun } from "../../contracts/awards";
import { holdCheckpoints, paceWal } from "../../db/checkpointer";
import { writeTx } from "../../db/tx";
import { ConflictError } from "../../errors";
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
import { type AwardRow, all, awardSql, one, run } from "./store";

/** The queue's job and the key that lets one run be under way at a time. */
export const REBUILD_JOB = "awards.rebuild";
/** The settings row that holds the run's progress and totals. */
const RECORD_KEY = "awards.rebuild";
/**
 * Members taken in order per chunk. Each statement that reads their facts covers them all, and
 * one statement runs on the thread that serves requests without a break: a page of members with
 * long histories, read for the first time, kept it for a quarter of a second at 25.
 */
export const REBUILD_CHUNK = 10;
/**
 * A chunk's transaction ends with the member that takes its grants and revocations to this many
 * (one member always, whatever they need): each is a dozen statements and two events.
 */
export const REBUILD_BUDGET = 30;
/**
 * A chunk's transaction also ends with the member it passes this many milliseconds on (one member
 * always): whatever the members need, it holds the thread and the write lock about this long.
 */
export const REBUILD_TIME_MS = 25;
/**
 * After a chunk the run rests as long as the chunk took, up to this many milliseconds: it then
 * has at most half of the thread that serves requests, and writes at most half as fast, so the
 * checkpoints that copy what it wrote stay short (a commit that overlaps a long one waits).
 */
const REBUILD_REST_MS = 50;
/** Awards listed in the status of a run, the ones most affected first. */
const LISTED_AWARDS = 20;

type Tally = { granted: number; takenBack: number };
type Totals = {
  members: number;
  /** Members whose stored XP or award count differed from the grants they hold. */
  xpCorrected: number;
  /** Members whose XP at the end differs from the XP they had. */
  xpChanged: number;
  levelsUp: number;
  levelsDown: number;
  granted: number;
  takenBack: number;
  creditsPaid: number;
  creditsRemoved: number;
  /** Members whose balance was not negative and is at the end. */
  newlyNegative: number;
  /** Per-member award counters (`member_award_totals.count`) that were repaired. */
  totalsCorrected: number;
};
type RunRecord = Totals & {
  state: "running" | "done" | "failed" | "stopped";
  /** True: the chunks run and are undone, so the figures are what a real run would do. */
  dryRun: boolean;
  /** Set by the administrator: the next chunk ends the run as stopped. */
  stopRequested: boolean;
  /** The administrator who started it. */
  by: number;
  startedAt: number;
  finishedAt: number | null;
  /** The last member passed. */
  after: number;
  /** The highest member id when it started: how far there is to go. */
  through: number;
  byAward: { [awardId: string]: Tally };
  error: string | null;
};

const NO_TOTALS: Totals = {
  members: 0,
  xpCorrected: 0,
  xpChanged: 0,
  levelsUp: 0,
  levelsDown: 0,
  granted: 0,
  takenBack: 0,
  creditsPaid: 0,
  creditsRemoved: 0,
  newlyNegative: 0,
  totalsCorrected: 0,
};

const HELD = "g.user_id = ?1 AND g.revoked_at IS NULL";
export const rebuildSql = {
  members: "SELECT id FROM users WHERE id > ?1 ORDER BY id LIMIT ?2",
  top: "SELECT max(id) AS id FROM users",
  stored: "SELECT id, award_xp, credits FROM users WHERE id IN (SELECT value FROM json_each(?1))",
  // The grants a member holds are the source of truth for both counters (the economy invariant).
  correct:
    `UPDATE users SET award_xp = (SELECT COALESCE(SUM(g.xp), 0) FROM member_awards g WHERE ${HELD}), ` +
    `award_count = (SELECT COUNT(*) FROM member_awards g WHERE ${HELD}) ` +
    `WHERE id = ?1 AND (award_xp != (SELECT COALESCE(SUM(g.xp), 0) FROM member_awards g WHERE ${HELD}) OR ` +
    `award_count != (SELECT COUNT(*) FROM member_awards g WHERE ${HELD})) RETURNING award_xp, award_count`,
  // A held grant with no counter row would count as not held and a non-stackable award be given
  // again. Whether the rules made it is unknown, so it is kept like a hand grant (`auto_granted` 0).
  insertTotals:
    "INSERT INTO member_award_totals (user_id, award_id, count, auto_granted, last_granted_at) " +
    "SELECT g.user_id, g.award_id, COUNT(*), 0, MAX(g.created_at) FROM member_awards g " +
    "WHERE g.user_id = ?1 AND g.revoked_at IS NULL GROUP BY g.award_id ON CONFLICT (user_id, award_id) DO NOTHING",
  // The count of a member's grants of one award decides whether a non-stackable award is given.
  correctTotals:
    "UPDATE member_award_totals SET count = (SELECT COUNT(*) FROM member_awards g WHERE g.user_id = member_award_totals.user_id " +
    "AND g.award_id = member_award_totals.award_id AND g.revoked_at IS NULL) WHERE user_id = ?1 AND count != " +
    "(SELECT COUNT(*) FROM member_awards g WHERE g.user_id = member_award_totals.user_id " +
    "AND g.award_id = member_award_totals.award_id AND g.revoked_at IS NULL)",
  correctAwards:
    "UPDATE awards SET grant_count = (SELECT COUNT(*) FROM member_awards g WHERE g.award_id = awards.id AND g.revoked_at IS NULL) " +
    "WHERE grant_count != (SELECT COUNT(*) FROM member_awards g WHERE g.award_id = awards.id AND g.revoked_at IS NULL)",
  xp: "SELECT award_xp, credits FROM users WHERE id = ?1",
  lastGrant: "SELECT COALESCE(MAX(id), 0) AS id FROM member_awards",
  lastEntry: "SELECT COALESCE(MAX(id), 0) AS id FROM credit_transactions",
  // By the grant id: the award index would be walked once per award and per revocation time.
  madeSince:
    "SELECT award_id, COUNT(*) AS n FROM member_awards NOT INDEXED WHERE id > ?1 GROUP BY award_id",
  paidSince:
    "SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) AS paid, COALESCE(SUM(CASE WHEN amount < 0 THEN -amount END), 0) AS removed FROM credit_transactions WHERE id > ?1",
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
  run(
    ctx,
    "rebuildLog",
    rebuildSql.log,
    record.by,
    // A preview has actions of its own, so the log never reads as a rebuild that happened.
    record.dryRun ? action.replace("awards.rebuild.", "awards.rebuildPreview.") : action,
    JSON.stringify({ ...details, dryRun: record.dryRun }),
    ctx.now(),
  );
}
function totalsOf(record: Totals): Totals {
  const totals = { ...NO_TOTALS };
  for (const key of Object.keys(totals) as (keyof Totals)[]) totals[key] = record[key];
  return totals;
}

/**
 * Starts a run, or resumes the one that stopped (on an error or by the administrator) when it is
 * the same kind. Returns false, changing nothing, when a run is under way. A preview is refused
 * while a real run is stopped, as it would replace the place to resume from. Call it in a write
 * transaction.
 */
export function startRebuild(ctx: Ctx, adminId: number, dryRun = false): boolean {
  const previous = readRecord(ctx);
  const open = previous !== null && previous.state !== "done";
  const resumed = open && previous.dryRun === dryRun;
  const after = resumed ? previous.after : 0;
  if (enqueueJob(ctx, REBUILD_JOB, { after }, { uniqueKey: REBUILD_JOB }) === null) return false;
  // This throws inside the caller's transaction, which undoes the job just queued.
  if (open && !previous.dryRun && dryRun)
    throw new ConflictError("A rebuild stopped; resume it before previewing another.");
  const record: RunRecord = resumed
    ? { ...previous, state: "running", by: adminId, stopRequested: false, error: null }
    : {
        ...NO_TOTALS,
        state: "running",
        dryRun,
        stopRequested: false,
        by: adminId,
        startedAt: ctx.now(),
        finishedAt: null,
        after: 0,
        through: one<{ id: number | null }>(ctx, "rebuildTop", rebuildSql.top)?.id ?? 0,
        byAward: {},
        error: null,
      };
  writeRecord(ctx, record);
  logRun(ctx, record, "awards.rebuild.start", { resumed });
  return true;
}

/** Asks the run under way to end after the chunk it is on; false when none is under way. */
export function stopRebuild(ctx: Ctx): boolean {
  const record = readRecord(ctx);
  if (record?.state !== "running") return false;
  record.stopRequested = true;
  writeRecord(ctx, record);
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
      dryRun: false,
      startedAt: null,
      finishedAt: null,
      progress: 0,
      ...NO_TOTALS,
      awards: [],
      error: null,
    };
  const names = new Map(all<AwardRow>(ctx, "catalog", awardSql.catalog).map((a) => [a.id, a.name]));
  return {
    state: record.state,
    dryRun: record.dryRun,
    startedAt: iso(record.startedAt),
    finishedAt: isoOrNull(record.finishedAt),
    progress:
      record.state === "done" || record.through <= 0
        ? Number(record.state === "done")
        : Math.min(1, record.after / record.through),
    ...totalsOf(record),
    awards: Object.entries(record.byAward)
      .map(([awardId, tally]) => ({
        awardId: Number(awardId),
        name: names.get(Number(awardId)) ?? "",
        ...tally,
      }))
      .sort((a, b) => b.granted + b.takenBack - (a.granted + a.takenBack) || a.awardId - b.awardId)
      .slice(0, LISTED_AWARDS),
    error: record.error,
  };
}

/** Ends the run as failed, in the transaction that completes its job: starting it again resumes it. */
function fail(ctx: Ctx, record: RunRecord, error: string): void {
  record.state = "failed";
  record.error = error;
  writeRecord(ctx, record);
  logRun(ctx, record, "awards.rebuild.failed", { error });
}

/** What a page of members came to: the figures to add to the run's, and the member it ended at. */
type PageResult = { last: number; totals: Totals; byAward: Map<number, Tally> };

/**
 * Rebuilds the members of a page, in order, until the changes they need reach `REBUILD_BUDGET`
 * or the time passes `REBUILD_TIME_MS`.
 * For each: sets XP, award count and the per-award counters to what the held grants add up to
 * (so the figures count every member corrected, and the facts the judging reads are right), takes
 * back the automatic grants they no longer qualify for (as `revoke.ts` does), then grants those
 * they qualify for (as the sweep does), except an award it just took back.
 */
function rebuildPage(
  ctx: Ctx,
  after: number,
  ids: number[],
  facts: Map<number, Facts>,
  seen: ReturnType<typeof activePlans>,
  by: number,
): PageResult {
  const started = ctx.now();
  const plans = confirmed(ctx, seen);
  const rules = plans.map((plan) => plan.rule);
  const step = readSiteSettings(ctx).levelStep;
  // The members as they are now: one who was deleted since the page was read is not there.
  const stored = new Map(
    all<{ id: number; award_xp: number; credits: number }>(
      ctx,
      "rebuildStored",
      rebuildSql.stored,
      JSON.stringify(ids),
    ).map((row) => [row.id, row]),
  );
  rereadMemberFacts(ctx, facts, rules);
  const byAward = new Map(plans.map((plan) => [plan.award.id, plan]));
  const earned = creditsEarnedKeys(rules);
  const held = new Map<number, HeldGrant[]>();
  for (const grant of heldBy(ctx, [...stored.keys()]))
    held.set(grant.user_id, [...(held.get(grant.user_id) ?? []), grant]);
  const lastGrant = one<{ id: number }>(ctx, "rebuildLastGrant", rebuildSql.lastGrant)!.id;
  const lastEntry = one<{ id: number }>(ctx, "rebuildLastEntry", rebuildSql.lastEntry)!.id;
  const totals = { ...NO_TOTALS };
  const tally = new Map<number, Tally>();
  const tallyOf = (awardId: number) => {
    const entry = tally.get(awardId) ?? { granted: 0, takenBack: 0 };
    tally.set(awardId, entry);
    return entry;
  };
  let work = 0;
  let last = after;
  for (const id of ids) {
    const was = stored.get(id);
    if (!was) continue;
    if (last !== after && (work >= REBUILD_BUDGET || ctx.now() - started >= REBUILD_TIME_MS)) break;
    const memberFacts = facts.get(id);
    const corrected = one<{ award_xp: number; award_count: number }>(
      ctx,
      "rebuildCorrect",
      rebuildSql.correct,
      id,
    );
    if (corrected) {
      totals.xpCorrected++;
      if (memberFacts) {
        memberFacts.awardXp = corrected.award_xp;
        memberFacts.awardCount = corrected.award_count;
      }
    }
    totals.totalsCorrected += run(ctx, "rebuildInsertTotals", rebuildSql.insertTotals, id).changes;
    totals.totalsCorrected += run(
      ctx,
      "rebuildCorrectTotals",
      rebuildSql.correctTotals,
      id,
    ).changes;
    const taken = memberFacts
      ? judge(ctx, held.get(id) ?? [], byAward, memberFacts, earned, by)
      : [];
    const { granted } = evaluate(
      ctx,
      [{ id }],
      plans,
      facts,
      Number.POSITIVE_INFINITY,
      new Set(taken.map((grant) => grant.award_id)),
    );
    for (const grant of taken) tallyOf(grant.award_id).takenBack++;
    work += taken.length + granted;
    totals.takenBack += taken.length;
    totals.granted += granted;
    totals.members++;
    const now = one<{ award_xp: number; credits: number }>(ctx, "rebuildXp", rebuildSql.xp, id)!;
    if (now.award_xp !== was.award_xp) totals.xpChanged++;
    const before = levelFor(was.award_xp, step).level;
    const after_ = levelFor(now.award_xp, step).level;
    if (after_ > before) totals.levelsUp++;
    if (after_ < before) totals.levelsDown++;
    if (was.credits >= 0 && now.credits < 0) totals.newlyNegative++;
    last = id;
  }
  for (const row of all<{ award_id: number; n: number }>(
    ctx,
    "rebuildMadeSince",
    rebuildSql.madeSince,
    lastGrant,
  ))
    tallyOf(row.award_id).granted += row.n;
  const paid = one<{ paid: number; removed: number }>(
    ctx,
    "rebuildPaid",
    rebuildSql.paidSince,
    lastEntry,
  )!;
  totals.creditsPaid = paid.paid;
  totals.creditsRemoved = paid.removed;
  return { last, totals, byAward: tally };
}

class Undone extends Error {}

/** Runs the page and, for a preview, undoes everything it wrote (not the figures it returns). */
function pageOf(ctx: Ctx, dryRun: boolean, work: () => PageResult): PageResult {
  if (!dryRun) return work();
  let result: PageResult | undefined;
  ctx.sqlite.run("SAVEPOINT rebuild_preview");
  try {
    result = work();
    throw new Undone();
  } catch (error) {
    ctx.sqlite.run("ROLLBACK TO rebuild_preview");
    if (!(error instanceof Undone)) throw error;
  } finally {
    ctx.sqlite.run("RELEASE rebuild_preview");
  }
  return result!;
}

/**
 * Rebuilds one page of members. The facts are read first, a statement at a time with a turn of
 * the event loop after each; then one transaction, which commits together with the job's
 * completion and its successor, rebuilds the members (`rebuildPage`). A preview does the same and
 * undoes it, keeping only the figures. A run that no longer owns the job, or that is not the one
 * the record describes, does nothing; one the administrator stopped ends before it.
 */
export async function rebuildChunk(ctx: Ctx, after: number, job: ClaimedJob): Promise<void> {
  if (!Number.isSafeInteger(after) || after < 0)
    throw new TypeError("Invalid award rebuild progress.");
  const began = performance.now();
  const ids = all<{ id: number }>(
    ctx,
    "rebuildMembers",
    rebuildSql.members,
    after,
    REBUILD_CHUNK,
  ).map((row) => row.id);
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
      if (record.after !== after) return fail(ctx, record, "The run does not match its record.");
      if (record.stopRequested) {
        record.state = "stopped";
        record.stopRequested = false;
        writeRecord(ctx, record);
        return logRun(ctx, record, "awards.rebuild.stopped", totalsOf(record));
      }
      if (!mayManage(ctx, record.by))
        return fail(
          ctx,
          record,
          "The administrator who started the run can no longer manage awards.",
        );
      const page = pageOf(ctx, record.dryRun, () =>
        rebuildPage(ctx, after, ids, facts, seen, record.by),
      );
      for (const key of Object.keys(page.totals) as (keyof Totals)[])
        record[key] += page.totals[key];
      for (const [awardId, add] of page.byAward) {
        const entry = record.byAward[awardId] ?? { granted: 0, takenBack: 0 };
        entry.granted += add.granted;
        entry.takenBack += add.takenBack;
        record.byAward[awardId] = entry;
      }
      record.after = page.last;
      if (page.last < (ids.at(-1) ?? 0) || ids.length === REBUILD_CHUNK)
        enqueueJob(ctx, REBUILD_JOB, { after: page.last }, { uniqueKey: REBUILD_JOB });
      else {
        // The holder count of each award, shown on the awards pages, from the grants held.
        if (!record.dryRun) run(ctx, "rebuildCorrectAwards", rebuildSql.correctAwards);
        record.state = "done";
        record.finishedAt = ctx.now();
        logRun(ctx, record, "awards.rebuild.done", totalsOf(record));
      }
      writeRecord(ctx, record);
    });
  } finally {
    release();
  }
  const rest = Math.min(REBUILD_REST_MS, performance.now() - began);
  await new Promise((resolve) => setTimeout(resolve, rest));
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
        if (record?.state === "running") fail(context, record, error);
      },
    },
  );
}
