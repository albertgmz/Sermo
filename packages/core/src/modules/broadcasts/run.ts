import type * as z from "zod";
import type { Ctx } from "../../context";
import type { BroadcastRun } from "../../contracts/broadcasts";
import { holdCheckpoints, paceWal } from "../../db/checkpointer";
import { writeTx } from "../../db/tx";
import { ConflictError, UnauthenticatedError, ValidationError } from "../../errors";
import { can, currentActor } from "../../permissions";
import { evaluate, everyone, type Facts, loadFactsPaced, type Rule } from "../../shared/criteria";
import { loadUserSummaries } from "../../shared/users";
import { iso, isoOrNull } from "../../time";
import { type ClaimedJob, completeRunningJob, enqueueJob, registerJobHandler } from "../jobs/queue";
import {
  deliverAlerts,
  deliverMessages,
  type Outcome,
  type Recipient,
  reachable,
  type StoredContent,
} from "./deliver";

/** The queue's job and the key that lets one run be under way at a time. */
export const BROADCAST_JOB = "broadcasts.run";
/** The settings row that holds the run: its content, audience and progress. */
const RECORD_KEY = "broadcasts.run";
/** Members taken in order per chunk: a conversation is a dozen statements, an alert a share of three. */
export const MESSAGE_CHUNK = 50;
export const ALERT_CHUNK = 200;

type RunRecord = {
  state: "running" | "done" | "failed" | "stopped" | "discarded";
  /** True: the chunks run and are undone, so the figures are what a real send would do. */
  dryRun: boolean;
  /** Set by the administrator: the next chunk ends the run as stopped. */
  stopRequested: boolean;
  /** The administrator who started it. */
  by: number;
  startedAt: number;
  finishedAt: number | null;
  content: StoredContent;
  rule: Rule;
  /** The last member passed. */
  after: number;
  /** The highest member id when it started: how far there is to go. */
  through: number;
  members: number;
  matched: number;
  sent: number;
  skipped: number;
  error: string | null;
};

export const broadcastSql = {
  members: "SELECT id FROM users WHERE id > ?1 ORDER BY id LIMIT ?2",
  top: "SELECT max(id) AS id FROM users",
  record: `SELECT value FROM site_settings WHERE key = '${RECORD_KEY}'`,
  setRecord: `INSERT INTO site_settings (key, value, updated_at) VALUES ('${RECORD_KEY}', ?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  log: "INSERT INTO moderator_log (actor_id, action, target_type, target_id, reason, details, created_at, node_id) VALUES (?1, ?2, 'broadcast', 0, '', ?3, ?4, NULL)",
};

function readRecord(ctx: Ctx): RunRecord | null {
  const row = ctx.sqlite.prepare<{ value: string }, []>(broadcastSql.record).get();
  return row ? (JSON.parse(row.value) as RunRecord) : null;
}
function writeRecord(ctx: Ctx, record: RunRecord): void {
  ctx.sqlite.prepare(broadcastSql.setRecord).run(JSON.stringify(record), ctx.now());
}

/** The administrator's trail, for a run or a test. */
export function logBroadcast(ctx: Ctx, adminId: number, action: string, details: object): void {
  ctx.sqlite.prepare(broadcastSql.log).run(adminId, action, JSON.stringify(details), ctx.now());
}
const logRun = (ctx: Ctx, record: RunRecord, name: string, details: object) =>
  // A count has actions of its own, so the log never reads as a send that happened.
  logBroadcast(ctx, record.by, `broadcast.${record.dryRun ? "count." : ""}${name}`, {
    ...details,
    kind: record.content.kind,
    dryRun: record.dryRun,
  });

/** Whether the administrator who started the run still holds `admin.announcements`, as the database says now. */
function mayBroadcast(ctx: Ctx, adminId: number): boolean {
  try {
    return can(
      ctx,
      currentActor(ctx, { kind: "user", userId: adminId, groupId: 0, sessionId: 0 }),
      "admin.announcements",
    );
  } catch (error) {
    // Only a member who is gone has lost the permission; any other error is the chunk's.
    if (error instanceof UnauthenticatedError) return false;
    throw error;
  }
}

/** The run an administrator looked at: its start time and kind, as broadcasts.status showed them. */
export type Seen = { runAt: number; kind: StoredContent["kind"] };

/** Whether the run is the one the administrator looked at. */
export const isSeen = (run: Pick<RunRecord, "startedAt" | "content">, seen: Seen) =>
  run.startedAt === seen.runAt && run.content.kind === seen.kind;

export const CHANGED = "The run changed since you looked at it; look at it again.";

/** The latest run's kind and content, for the checks an operation makes before it writes. */
export function latestRun(
  ctx: Ctx,
): Pick<RunRecord, "state" | "dryRun" | "content" | "by" | "startedAt"> | null {
  return readRecord(ctx);
}

const blank = (ctx: Ctx) => ({
  stopRequested: false,
  startedAt: ctx.now(),
  finishedAt: null,
  after: 0,
  through: ctx.sqlite.prepare<{ id: number | null }, []>(broadcastSql.top).get()?.id ?? 0,
  members: 0,
  matched: 0,
  sent: 0,
  skipped: 0,
  error: null,
});

/**
 * Queues a run that starts at the first member: false, changing nothing, when one is under way.
 * A run that stopped or failed must be resumed or discarded first, never replaced.
 */
function queueNew(ctx: Ctx, adminId: number, content: StoredContent, rule: Rule, dryRun: boolean) {
  const previous = readRecord(ctx);
  if (previous?.state === "stopped" || previous?.state === "failed")
    throw new ConflictError("A run is stopped: resume it or discard it before starting another.");
  if (enqueueJob(ctx, BROADCAST_JOB, { after: 0 }, { uniqueKey: BROADCAST_JOB }) === null)
    return false;
  const record: RunRecord = {
    ...blank(ctx),
    // The start time names the run (send, resume, discard and stop are given it): never repeated.
    startedAt: Math.max(ctx.now(), (previous?.startedAt ?? 0) + 1),
    state: "running",
    dryRun,
    by: adminId,
    content,
    rule,
  };
  writeRecord(ctx, record);
  logRun(ctx, record, "start", { rule });
  return true;
}

/** Starts a count of who the content would reach. Call it in a write transaction. */
export const countBroadcast = (ctx: Ctx, adminId: number, content: StoredContent, rule: Rule) =>
  queueNew(ctx, adminId, content, rule, true);

/**
 * Starts the send of the latest run's content and audience, which must be a finished count.
 * Call it in a write transaction.
 */
export function sendCounted(ctx: Ctx, adminId: number, countedAt: number): boolean {
  const previous = readRecord(ctx);
  if (previous?.state === "running") return false;
  if (previous?.state !== "done" || !previous.dryRun)
    throw new ValidationError("Count the recipients of this message or alert first, then send.");
  // What is sent is the count that was looked at, not a newer one.
  if (previous.startedAt !== countedAt)
    throw new ConflictError("The count changed since you looked at it; look at it again.");
  return queueNew(ctx, adminId, previous.content, previous.rule, false);
}

/**
 * The stopped or failed run the administrator looked at, after `authorize` accepted it: "running"
 * when a run is under way, "ended" when it is no longer stopped, a conflict when the latest run is
 * another one.
 */
function seenStopped(
  ctx: Ctx,
  seen: Seen,
  authorize: (run: RunRecord) => void,
): RunRecord | "running" | "ended" {
  const record = readRecord(ctx);
  if (record?.state === "running") return "running";
  if (!record || !isSeen(record, seen)) throw new ConflictError(CHANGED);
  if (record.state !== "stopped" && record.state !== "failed") return "ended";
  authorize(record);
  return record;
}

/**
 * Continues the stopped run the administrator looked at, with its own content and audience,
 * once `authorize` accepted it. False when one is under way. Call it in a write transaction.
 */
export function resumeBroadcast(
  ctx: Ctx,
  adminId: number,
  seen: Seen,
  authorize: (run: RunRecord) => void,
): boolean {
  const previous = seenStopped(ctx, seen, authorize);
  if (previous === "running") return false;
  if (previous === "ended") throw new ValidationError("There is no stopped run to resume.");
  if (
    enqueueJob(ctx, BROADCAST_JOB, { after: previous.after }, { uniqueKey: BROADCAST_JOB }) === null
  )
    return false;
  const record: RunRecord = {
    ...previous,
    state: "running",
    by: adminId,
    stopRequested: false,
    error: null,
  };
  writeRecord(ctx, record);
  logRun(ctx, record, "start", { resumed: true, after: record.after });
  return true;
}

/**
 * Gives up the stopped run the administrator looked at, once `authorize` accepted it, logged;
 * false when none is stopped. Call it in a write transaction.
 */
export function discardBroadcast(
  ctx: Ctx,
  adminId: number,
  seen: Seen,
  authorize: (run: RunRecord) => void,
): boolean {
  const previous = seenStopped(ctx, seen, authorize);
  if (typeof previous === "string") return false;
  previous.state = "discarded";
  previous.finishedAt = ctx.now();
  writeRecord(ctx, previous);
  logBroadcast(ctx, adminId, `broadcast.${previous.dryRun ? "count." : ""}discarded`, {
    kind: previous.content.kind,
    members: previous.members,
    sent: previous.sent,
  });
  return true;
}

/**
 * Asks the run under way, which started at `runAt`, to end after the chunk it is on; false when
 * none is under way, a conflict when another is.
 */
export function stopBroadcast(ctx: Ctx, runAt: number): boolean {
  const record = readRecord(ctx);
  if (record?.state !== "running") return false;
  if (record.startedAt !== runAt) throw new ConflictError(CHANGED);
  record.stopRequested = true;
  writeRecord(ctx, record);
  return true;
}

/** Who started the run and, for a message, who it comes from. */
function people(ctx: Ctx, record: RunRecord) {
  const senderId = record.content.kind === "message" ? record.content.senderId : null;
  const user = loadUserSummaries(ctx, senderId === null ? [record.by] : [record.by, senderId]);
  return { startedBy: user(record.by), sender: senderId === null ? null : user(senderId) };
}

/** The latest run as the contract returns it. */
export function broadcastRunValue(ctx: Ctx): z.infer<typeof BroadcastRun> {
  const record = readRecord(ctx);
  if (!record)
    return {
      state: "idle",
      kind: null,
      dryRun: false,
      summary: "",
      startedAt: null,
      startedBy: null,
      sender: null,
      finishedAt: null,
      progress: 0,
      members: 0,
      matched: 0,
      reachable: 0,
      sent: 0,
      skipped: 0,
      error: null,
    };
  return {
    state: record.state,
    kind: record.content.kind,
    dryRun: record.dryRun,
    summary: record.content.kind === "message" ? record.content.title : record.content.text,
    startedAt: iso(record.startedAt),
    ...people(ctx, record),
    finishedAt: isoOrNull(record.finishedAt),
    progress:
      record.state === "done" || record.through <= 0
        ? Number(record.state === "done")
        : Math.min(1, record.after / record.through),
    members: record.members,
    matched: record.matched,
    reachable: Math.max(0, record.matched - record.skipped),
    sent: record.sent,
    skipped: record.skipped,
    error: record.error,
  };
}

/** Ends the run as failed, in the transaction that completes its job: starting it again resumes it. */
function fail(ctx: Ctx, record: RunRecord, error: string): void {
  record.state = "failed";
  record.error = error;
  writeRecord(ctx, record);
  logRun(ctx, record, "failed", { error });
}

class Undone extends Error {}

/** Runs the delivery and, for a count, undoes everything it wrote (not the figures it returns). */
function deliveryOf(ctx: Ctx, dryRun: boolean, work: () => Outcome): Outcome {
  if (!dryRun) return work();
  let result: Outcome | undefined;
  ctx.sqlite.run("SAVEPOINT broadcast_count");
  try {
    result = work();
    throw new Undone();
  } catch (error) {
    ctx.sqlite.run("ROLLBACK TO broadcast_count");
    if (!(error instanceof Undone)) throw error;
  } finally {
    ctx.sqlite.run("RELEASE broadcast_count");
  }
  return result!;
}

function deliver(ctx: Ctx, record: RunRecord, matched: Recipient[]): Outcome {
  return record.content.kind === "message"
    ? deliverMessages(ctx, record.content, matched, record.dryRun)
    : deliverAlerts(ctx, record.content, matched, record.startedAt, record.dryRun);
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Handles one page of members. The facts the rule reads are loaded first, a statement at a time
 * with a turn of the event loop after each; then one transaction, which commits together with the
 * job's completion and its successor, writes to the members of the page who are reachable and
 * match the rule, and moves the record on. A count does the same and undoes the writes. A run
 * that no longer owns the job, or that is not the one the record describes, does nothing; one the
 * administrator stopped ends before it.
 */
export async function broadcastChunk(ctx: Ctx, after: number, job: ClaimedJob): Promise<void> {
  if (!Number.isSafeInteger(after) || after < 0) throw new TypeError("Invalid broadcast progress.");
  const peek = readRecord(ctx);
  const size = peek?.content.kind === "alert" ? ALERT_CHUNK : MESSAGE_CHUNK;
  const rule = peek?.rule ?? everyone();
  const ids = ctx.sqlite
    .prepare<{ id: number }, [number, number]>(broadcastSql.members)
    .all(after, size)
    .map((row) => row.id);
  const facts =
    rule.conditions.length === 0 || ids.length === 0
      ? new Map<number, Facts>()
      : await loadFactsPaced(ctx, ids, [rule], nextTurn);
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
        return logRun(ctx, record, "stopped", { members: record.members, sent: record.sent });
      }
      if (!mayBroadcast(ctx, record.by))
        return fail(ctx, record, "The administrator who started the run can no longer send.");
      const matched = reachable(ctx, ids).filter((member) => {
        const memberFacts = facts.get(member.id);
        return (
          rule.conditions.length === 0 || (memberFacts !== undefined && evaluate(rule, memberFacts))
        );
      });
      const outcome = deliveryOf(ctx, record.dryRun, () => deliver(ctx, record, matched));
      record.members += ids.length;
      record.matched += matched.length;
      record.sent += record.dryRun ? 0 : outcome.sent;
      record.skipped += outcome.skipped;
      record.after = ids.at(-1) ?? after;
      if (ids.length === size)
        enqueueJob(ctx, BROADCAST_JOB, { after: record.after }, { uniqueKey: BROADCAST_JOB });
      else {
        record.state = "done";
        record.finishedAt = ctx.now();
        logRun(ctx, record, "done", {
          members: record.members,
          matched: record.matched,
          sent: record.sent,
          skipped: record.skipped,
        });
      }
      writeRecord(ctx, record);
    });
  } finally {
    release();
  }
}

export function registerBroadcastJobs(ctx: Ctx): void {
  registerJobHandler(
    ctx,
    BROADCAST_JOB,
    async (context, payload, job) => {
      await broadcastChunk(context, (payload as { after: number }).after, job);
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
