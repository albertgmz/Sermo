import type { SQLQueryBindings } from "bun:sqlite";
import * as z from "zod";
import { type Ctx, prepared } from "../../context";
import type { CreditTaxRun } from "../../contracts/credits";
import { GUEST_ACCOUNT_ID } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError } from "../../errors";
import { moveCredits } from "../../shared/credits";
import { loadUserSummaries } from "../../shared/users";
import { iso, isoOrNull } from "../../time";
import { type ClaimedJob, completeRunningJob, enqueueJob, registerJobHandler } from "../jobs/queue";
import { deliverDirect } from "../notifications/direct";
import { readSiteSettings } from "../settings";

/** The queue's job: one chunk of members of one run. */
export const TAX_JOB = "credits.tax";
/** Members looked at per chunk; each chunk commits in its own transaction. */
export const TAX_CHUNK = 100;
/** The notice goes out this long before each charge. */
export const TAX_NOTICE_MS = 7 * 86_400_000;
/** The inactivity part of a charge never takes more than this percent of the balance. */
const MAX_PERCENT = 50;
/** The `site_settings` row that remembers when the tax was last turned on (UTC ms). */
const ENABLED_AT_KEY = "credit_tax_enabled_at";
const TOP = 20;

type Kind = "charge" | "notice" | "preview";
interface RunRow {
  id: number;
  kind: Kind;
  month: number;
  state: "running" | "done" | "stopped" | "failed";
  fee: number;
  minimum: number;
  step: number;
  started_by: number | null;
  last_user_id: number;
  through: number;
  members: number;
  credits: number;
  top: string;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
}
interface Counted {
  userId: number;
  balance: number;
  months: number;
  charge: number;
}
type Rates = Pick<RunRow, "fee" | "minimum" | "step">;

export const taxSql = {
  run: "SELECT * FROM credit_tax_runs WHERE id = ?1",
  latest: "SELECT * FROM credit_tax_runs WHERE kind = ?1 ORDER BY id DESC LIMIT 1",
  ofMonth:
    "SELECT * FROM credit_tax_runs WHERE kind = ?1 AND month = ?2 AND kind != 'preview' LIMIT 1",
  previewRunning:
    "SELECT id FROM credit_tax_runs WHERE kind = 'preview' AND state = 'running' LIMIT 1",
  top: "SELECT max(id) AS id FROM users",
  insert:
    "INSERT INTO credit_tax_runs (kind, month, fee, minimum, step, started_by, through, created_at, updated_at) " +
    "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8) ON CONFLICT DO NOTHING RETURNING *",
  resume: "UPDATE credit_tax_runs SET state = 'running', updated_at = ?2 WHERE id = ?1",
  advance:
    "UPDATE credit_tax_runs SET last_user_id = ?2, members = ?3, credits = ?4, top = ?5, updated_at = ?6 WHERE id = ?1",
  finish:
    "UPDATE credit_tax_runs SET state = 'done', last_user_id = ?2, members = ?3, credits = ?4, top = ?5, updated_at = ?6, finished_at = ?6 WHERE id = ?1",
  end: "UPDATE credit_tax_runs SET state = ?2, updated_at = ?3, finished_at = ?3 WHERE id = ?1 AND state = 'running'",
  // Only a positive balance is ever charged. The walk starts after 0, so the guest account
  // (a negative id) is never reached; it is named as well, to say so.
  members:
    "SELECT id, credits, coalesce(last_activity_at, created_at) AS seen FROM users " +
    `WHERE id > ?1 AND id != ${GUEST_ACCOUNT_ID} AND erased_at IS NULL AND credits > 0 ORDER BY id LIMIT ?2`,
  charged:
    "SELECT 1 AS found FROM credit_transactions WHERE source_type = 'tax' AND user_id = ?1 AND source_id = ?2",
  enabledAt: `SELECT value FROM site_settings WHERE key = '${ENABLED_AT_KEY}'`,
  storeEnabledAt:
    `INSERT INTO site_settings (key, value, updated_at) VALUES ('${ENABLED_AT_KEY}', ?1, ?1) ` +
    "ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
} as const;

function sql<T>(ctx: Ctx, key: keyof typeof taxSql) {
  return prepared(ctx, `credits.tax.${key}`, () =>
    ctx.sqlite.prepare<T, SQLQueryBindings[]>(taxSql[key]),
  );
}
const one = <T>(ctx: Ctx, key: keyof typeof taxSql, ...args: SQLQueryBindings[]) =>
  sql<T>(ctx, key).get(...args);
const run = (ctx: Ctx, key: keyof typeof taxSql, ...args: SQLQueryBindings[]) =>
  sql(ctx, key).run(...args);

// Months -------------------------------------------------------------------------------------

/** The month (YYYYMM, UTC) of a moment. */
export function monthOf(ms: number): number {
  const date = new Date(ms);
  return date.getUTCFullYear() * 100 + date.getUTCMonth() + 1;
}
/** The start (UTC midnight of the 1st) of a month. */
export function monthStart(month: number): number {
  return Date.UTC(Math.floor(month / 100), (month % 100) - 1, 1);
}
const nextMonth = (month: number) => monthOf(Date.UTC(Math.floor(month / 100), month % 100, 1));
const monthIndex = (ms: number) => {
  const date = new Date(ms);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
};

/**
 * Whole calendar months with no visit between the month of the last visit and the month of the
 * charge: a charge on 1 November counts 0 for a visit in October (or in November) and 1 for a
 * visit in September.
 */
export function inactiveMonths(seen: number, chargeAt: number): number {
  return Math.max(0, monthIndex(chargeAt) - monthIndex(seen) - 1);
}

/**
 * The charge: the fee when the balance is above the minimum, plus `step` percent per inactive
 * month (at most 50) of the balance, rounded down; never more than the balance, never below 0.
 */
export function taxCharge(balance: number, months: number, rates: Rates): number {
  if (balance <= 0) return 0;
  const percent = Math.min(rates.step * months, MAX_PERCENT);
  // balance * percent / 100, rounded down, without leaving the range of exact integers.
  const share = Math.floor(balance / 100) * percent + Math.floor(((balance % 100) * percent) / 100);
  const fee = balance > rates.minimum ? rates.fee : 0;
  return Math.max(0, Math.min(balance, fee + share));
}

// Settings -----------------------------------------------------------------------------------

/** Remembers that the tax was turned on now. Call in the settings update's write transaction. */
export function markCreditTaxTurnedOn(ctx: Ctx): void {
  run(ctx, "storeEnabledAt", ctx.now());
}

/** Whether the tax charges on the 1st of `month`: it is on, and was turned on before that day. */
function taxApplies(ctx: Ctx, month: number): boolean {
  if (!readSiteSettings(ctx).creditTaxEnabled) return false;
  const enabledAt = one<{ value: string }>(ctx, "enabledAt")?.value;
  return enabledAt !== undefined && Number(enabledAt) < monthStart(month);
}

function rates(ctx: Ctx): Rates {
  const settings = readSiteSettings(ctx);
  return {
    fee: settings.creditTaxFee,
    minimum: settings.creditTaxMinimum,
    step: settings.creditTaxStep,
  };
}

// Runs ---------------------------------------------------------------------------------------

/** Queues the chunk of `run` after `after`; one key per run, so runs never wait on each other. */
function queueChunk(ctx: Ctx, runId: number, after: number): void {
  enqueueJob(ctx, TAX_JOB, { runId, after }, { uniqueKey: `${TAX_JOB}:${runId}` });
}

function insertRun(ctx: Ctx, kind: Kind, month: number, startedBy: number | null): RunRow | null {
  const { fee, minimum, step } = rates(ctx);
  const top = one<{ id: number | null }>(ctx, "top")?.id ?? 0;
  const row = one<RunRow>(
    ctx,
    "insert",
    kind,
    month,
    fee,
    minimum,
    step,
    startedBy,
    top,
    ctx.now(),
  );
  if (row) queueChunk(ctx, row.id, 0);
  return row ?? null;
}

/**
 * Starts the charge or the notice of `month` once. A run that failed (its job kept failing)
 * goes on from the last member it finished; one under way, done or stopped is left alone.
 */
function startScheduled(ctx: Ctx, kind: "charge" | "notice", month: number): void {
  const existing = one<RunRow>(ctx, "ofMonth", kind, month);
  if (!existing) {
    insertRun(ctx, kind, month, null);
    return;
  }
  if (existing.state !== "failed") return;
  run(ctx, "resume", existing.id, ctx.now());
  queueChunk(ctx, existing.id, existing.last_user_id);
}

/**
 * The daily look at the tax (03:00 UTC): from the 1st of a month the charge of that month, and
 * from 7 days before the next 1st the notice of the next charge, each once and only while the tax
 * applies to that charge. A day the server missed is caught up on the next run.
 */
export function scheduleCreditTax(ctx: Ctx): void {
  const now = ctx.now();
  const current = monthOf(now);
  const next = nextMonth(current);
  writeTx(ctx, () => {
    if (taxApplies(ctx, current)) startScheduled(ctx, "charge", current);
    if (now >= monthStart(next) - TAX_NOTICE_MS && taxApplies(ctx, next))
      startScheduled(ctx, "notice", next);
  });
}

/** Starts a preview of the next charge, in the caller's write transaction. */
export function startTaxPreview(ctx: Ctx, adminId: number): RunRow {
  if (one(ctx, "previewRunning"))
    throw new ConflictError("A preview of the credit tax is under way.");
  return insertRun(ctx, "preview", nextMonth(monthOf(ctx.now())), adminId)!;
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A run as the contract returns it. */
export function taxRunValue(ctx: Ctx, row: RunRow): z.infer<typeof CreditTaxRun> {
  const top = JSON.parse(row.top) as Counted[];
  const user = loadUserSummaries(
    ctx,
    top.map((entry) => entry.userId),
  );
  return {
    id: row.id,
    kind: row.kind,
    chargeOn: day(monthStart(row.month)),
    state: row.state,
    fee: row.fee,
    minimum: row.minimum,
    step: row.step,
    progress:
      row.state === "done" ? 1 : row.through <= 0 ? 0 : Math.min(1, row.last_user_id / row.through),
    members: row.members,
    credits: row.credits,
    top: top.map((entry) => ({
      user: user(entry.userId),
      balance: entry.balance,
      months: entry.months,
      charge: entry.charge,
    })),
    startedAt: iso(row.created_at),
    finishedAt: isoOrNull(row.finished_at),
  };
}

/** The 1st of the month of the next charge, null while the tax is off. */
function nextChargeOn(ctx: Ctx): string | null {
  if (!readSiteSettings(ctx).creditTaxEnabled) return null;
  const current = monthOf(ctx.now());
  const charge = one<RunRow>(ctx, "ofMonth", "charge", current);
  const pending = !charge || charge.state === "running" || charge.state === "failed";
  if (pending && taxApplies(ctx, current)) return day(monthStart(current));
  const next = nextMonth(current);
  return taxApplies(ctx, next) ? day(monthStart(next)) : null;
}

export function taxStatus(ctx: Ctx) {
  const latest = (kind: Kind) => {
    const row = one<RunRow>(ctx, "latest", kind);
    return row ? taxRunValue(ctx, row) : null;
  };
  return {
    enabled: readSiteSettings(ctx).creditTaxEnabled,
    nextChargeOn: nextChargeOn(ctx),
    preview: latest("preview"),
    lastCharge: latest("charge"),
  };
}

// Chunks -------------------------------------------------------------------------------------

/** What each member of the page owes on the run's charge day, as their row says now. */
function countPage(run: RunRow, page: { id: number; credits: number; seen: number }[]): Counted[] {
  const chargeAt = monthStart(run.month);
  const counted: Counted[] = [];
  for (const member of page) {
    const months = inactiveMonths(member.seen, chargeAt);
    const charge = taxCharge(member.credits, months, run);
    // The notice is for members whose charge is more than the fee alone: a visit avoids the rest.
    const fee = member.credits > run.minimum ? run.fee : 0;
    if (charge <= 0 || (run.kind === "notice" && charge <= fee)) continue;
    counted.push({ userId: member.id, balance: member.credits, months, charge });
  }
  return counted;
}

/** Charges each counted member once for the month; returns those charged. */
function charge(ctx: Ctx, run: RunRow, counted: Counted[]): Counted[] {
  const charged = counted.filter((member) => !one(ctx, "charged", member.userId, run.month));
  if (charged.length)
    moveCredits(
      ctx,
      charged.map((member) => ({
        userId: member.userId,
        amount: -member.charge,
        type: "tax" as const,
        source: { type: "tax", id: run.month },
      })),
    );
  return charged;
}

/** Warns each counted member; returns those an alert reached (preferences and bans decide). */
function warn(ctx: Ctx, run: RunRow, counted: Counted[]): Counted[] {
  const alerted = deliverDirect(
    ctx,
    "credits.tax",
    null,
    counted.map((member) => ({
      userId: member.userId,
      contentType: "credit_tax",
      contentId: run.month,
      // The charge, and the part of it a visit does not avoid (the fee).
      data: { amount: member.charge, fee: member.balance > run.minimum ? run.fee : 0 },
    })),
  );
  return counted.filter((member) => alerted.has(member.userId));
}

const payloadSchema = z.object({
  runId: z.number().int().positive(),
  after: z.number().int().nonnegative(),
});

/**
 * One chunk of a run, in one transaction with the job's completion and its successor, so a
 * restart never repeats a chunk: checks the run is at the job's place (and, for a charge or a
 * notice, that the tax still applies to its month, else the run stops), counts the members after
 * `after` as their rows are now, charges or warns them, then queues the next chunk or finishes.
 * The ledger's unique key on (member, `tax`, month) is the last guard against a second charge.
 */
export function taxChunk(ctx: Ctx, payload: unknown, job: ClaimedJob): void {
  const { runId, after } = payloadSchema.parse(payload);
  writeTx(ctx, () => {
    if (!completeRunningJob(ctx, job)) return;
    const current = one<RunRow>(ctx, "run", runId);
    if (current?.state !== "running") return;
    // A stale copy of a chunk already done: the run's own next chunk is queued already.
    if (current.last_user_id !== after) return;
    if (current.kind !== "preview" && !taxApplies(ctx, current.month))
      return void run(ctx, "end", runId, "stopped", ctx.now());
    const page = sql<{ id: number; credits: number; seen: number }>(ctx, "members").all(
      after,
      TAX_CHUNK,
    );
    let counted = countPage(current, page);
    if (current.kind === "charge") counted = charge(ctx, current, counted);
    else if (current.kind === "notice") counted = warn(ctx, current, counted);
    const top = [...(JSON.parse(current.top) as Counted[]), ...counted]
      .sort((a, b) => b.charge - a.charge || a.userId - b.userId)
      .slice(0, TOP);
    const figures = [
      page.at(-1)?.id ?? after,
      current.members + counted.length,
      current.credits + counted.reduce((sum, member) => sum + member.charge, 0),
      JSON.stringify(top),
      ctx.now(),
    ];
    if (page.length < TAX_CHUNK) return void run(ctx, "finish", runId, ...figures);
    run(ctx, "advance", runId, ...figures);
    queueChunk(ctx, runId, figures[0] as number);
  });
}

export function registerTaxJobs(ctx: Ctx): void {
  registerJobHandler(ctx, TAX_JOB, taxChunk, {
    // A run whose job keeps failing stops here; the daily look goes on with a charge or a
    // notice from where it stopped. The error itself stays in the job's row.
    onFailed: (context, { payload }) => {
      const { runId } = payload as { runId: number };
      run(context, "end", runId, "failed", context.now());
    },
  });
}
