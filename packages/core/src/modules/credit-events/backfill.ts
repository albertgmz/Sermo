import type { SQLQueryBindings } from "bun:sqlite";
import type * as z from "zod";
import { type Ctx, prepared } from "../../context";
import { BACKFILL_CREDIT_TRIGGERS, type CreditBackfill } from "../../contracts/credits";
import { holdCheckpoints, paceWal } from "../../db/checkpointer";
import { type CREDIT_BACKFILL_ERRORS, GUEST_ACCOUNT_ID } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError, NotFoundError, UnauthenticatedError, ValidationError } from "../../errors";
import { can, currentActor } from "../../permissions";
import { moveCredits } from "../../shared/credits";
import { loadUserSummaries } from "../../shared/users";
import { iso, isoOrNull } from "../../time";
import { type ClaimedJob, completeRunningJob, enqueueJob, registerJobHandler } from "../jobs/queue";
import { query, type RuleRow, type Trigger } from "./storage";
import { judged, qualifies, RECEIVED } from "./subscriber";

/** The queue's job, and the key that lets one run be under way at a time. */
export const BACKFILL_JOB = "creditRules.backfill";
/** Members looked at per chunk; each chunk commits in its own transaction. */
export const BACKFILL_CHUNK = 100;

type Mode = "preview" | "apply";
interface RunRow {
  id: number;
  mode: Mode;
  state: "running" | "done" | "failed";
  preview_id: number | null;
  from_at: number;
  until_at: number;
  cap: number;
  started_by: number;
  last_user_id: number;
  through: number;
  rules: string;
  by_trigger: string;
  summary: string | null;
  error: (typeof CREDIT_BACKFILL_ERRORS)[number] | null;
  created_at: number;
  finished_at: number | null;
}
interface Summary {
  members: number;
  credits: number;
  heldAtCap: number;
  byTrigger: Record<string, number>;
  paid: { p50: number; p90: number; p99: number; max: number };
  top: { userId: number; total: number; paid: number }[];
}
/** A source a rule pays for: `at` places it in the dates and the limit; filters judge `created_at`. */
interface SourceRow {
  type: string;
  id: number;
  at: number;
  created_at: number;
  node_id: number | null;
  other: number;
}

// The reacted-to content must be visible, and so must its parent (a post's thread, a comment's
// profile post); a reaction in a conversation, or whose type lowers the score, pays nobody.
const reactions = (who: "user_id" | "content_user_id", other: string) =>
  `SELECT r.content_type AS type, r.content_id AS id, r.created_at AS at, ` +
  `coalesce(p.created_at, pp.created_at, c.created_at) AS created_at, t.node_id, ${other} AS other ` +
  "FROM reactions r JOIN reaction_types y ON y.id = r.reaction_type_id AND y.score >= 0 " +
  "LEFT JOIN posts p ON r.content_type = 'post' AND p.id = r.content_id " +
  "LEFT JOIN threads t ON t.id = p.thread_id " +
  "LEFT JOIN profile_posts pp ON r.content_type = 'profile_post' AND pp.id = r.content_id " +
  "LEFT JOIN profile_post_comments c ON r.content_type = 'profile_post_comment' AND c.id = r.content_id " +
  "LEFT JOIN profile_posts cp ON cp.id = c.profile_post_id " +
  `WHERE r.${who} = ?1 AND r.created_at >= ?2 AND r.created_at < ?3 AND CASE r.content_type ` +
  "WHEN 'post' THEN p.state = 'visible' AND t.state = 'visible' " +
  "WHEN 'profile_post' THEN pp.state = 'visible' " +
  "WHEN 'profile_post_comment' THEN c.state = 'visible' AND cp.state = 'visible' " +
  "ELSE 0 END ORDER BY r.created_at, r.id";

/**
 * The sources of each trigger paid to member ?1 from ?2 (inclusive) to ?3 (exclusive), in time
 * order, judged on the rows as they are now: what the subscriber pays when the event happens. A
 * guest's content pays no one.
 */
const SOURCES: Record<(typeof BACKFILL_CREDIT_TRIGGERS)[number], string> = {
  thread_created:
    "SELECT 'thread' AS type, id, created_at AS at, created_at, node_id, 0 AS other FROM threads " +
    "WHERE user_id = ?1 AND state = 'visible' AND created_at >= ?2 AND created_at < ?3 ORDER BY created_at, id",
  reply_posted:
    "SELECT 'post' AS type, p.id, p.created_at AS at, p.created_at, t.node_id, 0 AS other FROM posts p " +
    "JOIN threads t ON t.id = p.thread_id WHERE p.user_id = ?1 AND p.state = 'visible' AND p.position > 0 " +
    "AND p.created_at >= ?2 AND p.created_at < ?3 AND t.state = 'visible' ORDER BY p.created_at, p.id",
  reply_received:
    "SELECT 'post' AS type, p.id, p.created_at AS at, p.created_at, t.node_id, p.user_id AS other FROM threads t " +
    "JOIN posts p ON p.thread_id = t.id WHERE t.user_id = ?1 AND t.state = 'visible' AND p.state = 'visible' " +
    `AND p.position > 0 AND p.user_id NOT IN (?1, ${GUEST_ACCOUNT_ID}) AND p.created_at >= ?2 AND p.created_at < ?3 ` +
    "ORDER BY p.created_at, p.id",
  reaction_given: reactions("user_id", "0"),
  reaction_received: reactions("content_user_id", "r.user_id"),
  profile_post_created:
    "SELECT 'profile_post' AS type, id, created_at AS at, created_at, NULL AS node_id, 0 AS other FROM profile_posts " +
    "WHERE user_id = ?1 AND profile_user_id != ?1 AND state = 'visible' AND created_at >= ?2 AND created_at < ?3 " +
    "ORDER BY created_at, id",
  profile_post_received:
    "SELECT 'profile_post' AS type, id, created_at AS at, created_at, NULL AS node_id, user_id AS other FROM profile_posts " +
    `WHERE profile_user_id = ?1 AND user_id NOT IN (?1, ${GUEST_ACCOUNT_ID}) AND state = 'visible' ` +
    "AND created_at >= ?2 AND created_at < ?3 ORDER BY created_at, id",
  followed:
    "SELECT 'user' AS type, user_id AS id, created_at AS at, created_at, NULL AS node_id, 0 AS other FROM user_follows " +
    "WHERE followed_id = ?1 AND created_at >= ?2 AND created_at < ?3 ORDER BY created_at, id",
  award_received:
    "SELECT 'member_award' AS type, id, created_at AS at, created_at, NULL AS node_id, 0 AS other FROM member_awards " +
    "WHERE user_id = ?1 AND revoked_at IS NULL AND created_at >= ?2 AND created_at < ?3 ORDER BY created_at, id",
};

const backfillSql = {
  run: "SELECT * FROM credit_backfills WHERE id = ?1",
  latest: "SELECT * FROM credit_backfills ORDER BY id DESC LIMIT 1",
  running: "SELECT id FROM credit_backfills WHERE state = 'running' LIMIT 1",
  paidRange:
    "SELECT min(from_at) AS from_at, max(until_at) AS until_at FROM credit_backfills WHERE mode = 'apply'",
  top: "SELECT max(id) AS id FROM users",
  insert:
    "INSERT INTO credit_backfills (mode, preview_id, from_at, until_at, cap, started_by, through, rules, created_at, updated_at) " +
    "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9) RETURNING *",
  advance:
    "UPDATE credit_backfills SET last_user_id = ?2, by_trigger = ?3, updated_at = ?4 WHERE id = ?1",
  finish:
    "UPDATE credit_backfills SET state = 'done', last_user_id = ?2, by_trigger = ?3, summary = ?4, updated_at = ?5, finished_at = ?5 WHERE id = ?1",
  fail: "UPDATE credit_backfills SET state = 'failed', error = ?2, updated_at = ?3, finished_at = ?3 WHERE id = ?1 AND state = 'running'",
  members: "SELECT id FROM users WHERE id > ?1 AND erased_at IS NULL ORDER BY id LIMIT ?2",
  rules:
    "SELECT * FROM credit_rules WHERE is_active = 1 AND trigger IN (SELECT value FROM json_each(?1)) ORDER BY id",
  // Paid by the live subscriber already (content approved after the rule was made, for one).
  appliedTo:
    "SELECT 1 AS found FROM credit_rule_applications WHERE rule_id = ?1 AND user_id = ?2 AND source_type = ?3 AND source_id = ?4 AND source_user_id = ?5",
  earlier:
    "SELECT coalesce(sum(amount), 0) AS paid FROM credit_transactions WHERE user_id = ?1 AND type = 'backfill'",
  result:
    "INSERT INTO credit_backfill_members (run_id, user_id, total, paid) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (run_id, user_id) DO NOTHING RETURNING id",
  results: "SELECT user_id, total, paid FROM credit_backfill_members WHERE run_id = ?1",
} as const;

function sql<T>(ctx: Ctx, key: string, text: string) {
  return prepared(ctx, `credit-events.backfill.${key}`, () =>
    ctx.sqlite.prepare<T, SQLQueryBindings[]>(text),
  );
}
const one = <T>(ctx: Ctx, key: keyof typeof backfillSql, ...args: SQLQueryBindings[]) =>
  sql<T>(ctx, key, backfillSql[key]).get(...args);
const run = (ctx: Ctx, key: keyof typeof backfillSql, ...args: SQLQueryBindings[]) =>
  sql(ctx, key, backfillSql[key]).run(...args);

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

/** The dates the payments made so far cover, from the first's start to the last's end. */
function paidRange(ctx: Ctx): { from: number; until: number } | null {
  const row = one<{ from_at: number | null; until_at: number | null }>(ctx, "paidRange");
  return row?.from_at == null ? null : { from: row.from_at, until: row.until_at! };
}

/**
 * Starts a run in the caller's write transaction. Refused while another runs, and when its dates
 * do not include those already paid: what a member was paid before is taken off their total, which
 * is right only when the total covers it.
 */
export function startBackfill(
  ctx: Ctx,
  adminId: number,
  params: { mode: Mode; from: number; until: number; cap: number; previewId: number | null },
): RunRow {
  if (params.from >= params.until)
    throw new ValidationError("The from date must be before the until date.");
  if (one(ctx, "running")) throw new ConflictError("A payment of past activity is under way.");
  const paid = paidRange(ctx);
  if (paid && (params.from > paid.from || params.until < paid.until))
    throw new ConflictError(
      `The dates must include ${day(paid.from)} to ${day(paid.until)}, the dates already paid.`,
    );
  const row = one<RunRow>(
    ctx,
    "insert",
    params.mode,
    params.previewId,
    params.from,
    params.until,
    params.cap,
    adminId,
    one<{ id: number | null }>(ctx, "top")?.id ?? 0,
    // The rules as they are now: every chunk of the run counts with these, whatever changes later.
    JSON.stringify(
      sql<RuleRow>(ctx, "rules", backfillSql.rules).all(JSON.stringify(BACKFILL_CREDIT_TRIGGERS)),
    ),
    ctx.now(),
  )!;
  if (
    enqueueJob(ctx, BACKFILL_JOB, { runId: row.id, after: 0 }, { uniqueKey: BACKFILL_JOB }) === null
  )
    throw new ConflictError("A payment of past activity is under way.");
  return row;
}

/** The preview to pay: refused unless it is a preview that finished. */
export function finishedPreview(ctx: Ctx, previewId: number): RunRow {
  const row = one<RunRow>(ctx, "run", previewId);
  if (row?.mode !== "preview") throw new NotFoundError();
  if (row.state !== "done") throw new ConflictError("Only a finished preview can be paid.");
  return row;
}

/** A run as the contract returns it. */
export function backfillValue(ctx: Ctx, row: RunRow): z.infer<typeof CreditBackfill> {
  const summary = row.summary === null ? null : (JSON.parse(row.summary) as Summary);
  const user = summary
    ? loadUserSummaries(
        ctx,
        summary.top.map((top) => top.userId),
      )
    : null;
  return {
    id: row.id,
    mode: row.mode,
    state: row.state,
    previewId: row.preview_id,
    from: day(row.from_at),
    until: day(row.until_at),
    cap: row.cap,
    progress:
      row.state === "done" ? 1 : row.through <= 0 ? 0 : Math.min(1, row.last_user_id / row.through),
    startedAt: iso(row.created_at),
    finishedAt: isoOrNull(row.finished_at),
    error: row.error,
    summary: summary && {
      members: summary.members,
      credits: summary.credits,
      heldAtCap: summary.heldAtCap,
      byTrigger: BACKFILL_CREDIT_TRIGGERS.map((trigger) => ({
        trigger,
        credits: summary.byTrigger[trigger] ?? 0,
      })),
      paid: summary.paid,
      top: summary.top.map((top) => ({
        user: user!(top.userId),
        total: top.total,
        paid: top.paid,
      })),
    },
  };
}

export function backfillStatus(ctx: Ctx) {
  const latest = one<RunRow>(ctx, "latest");
  const paid = paidRange(ctx);
  return {
    latest: latest ? backfillValue(ctx, latest) : null,
    paidRange: paid && { from: day(paid.from), until: day(paid.until) },
  };
}

interface Plan {
  rule: RuleRow;
  /** The end of the dates the rule pays: never at or after its own creation. */
  until: number;
  nodes: number[];
  received: boolean;
}

function plans(row: RunRow): Plan[] {
  const { from_at: from, until_at: until } = row;
  return (JSON.parse(row.rules) as RuleRow[])
    .map((rule) => ({
      rule,
      until: Math.min(until, rule.created_at),
      nodes: JSON.parse(rule.node_ids) as number[],
      received: RECEIVED.includes(rule.trigger),
    }))
    .filter((plan) => plan.until > from);
}

function alreadyApplied(ctx: Ctx, plan: Plan, userId: number, row: SourceRow): boolean {
  // A received trigger pays once per source, whoever receives it.
  if (plan.received)
    return !!query(ctx, "sourceApplied").get(row.type, row.id, plan.rule.id, row.other);
  return !!one(ctx, "appliedTo", plan.rule.id, userId, row.type, row.id, row.other);
}

/**
 * What one rule would have paid the member, as the subscriber pays: forums, filters, then the
 * limit, counting a source only while fewer than `limit_count` paid ones fall in the window that
 * ends at it, in time order.
 */
function rulePays(ctx: Ctx, plan: Plan, userId: number, from: number): number {
  const { rule } = plan;
  const trigger = rule.trigger as (typeof BACKFILL_CREDIT_TRIGGERS)[number];
  const paidAt: number[] = [];
  let start = 0;
  for (const row of sql<SourceRow>(ctx, `sources.${trigger}`, SOURCES[trigger]).all(
    userId,
    from,
    plan.until,
  )) {
    if (plan.nodes.length && (row.node_id === null || !plan.nodes.includes(row.node_id))) continue;
    if (
      !qualifies(rule, {
        type: row.type,
        id: row.id,
        ...judged(ctx, row.type, row.id, row.created_at),
      })
    )
      continue;
    if (alreadyApplied(ctx, plan, userId, row)) continue;
    if (rule.limit_count !== null) {
      const cutoff = row.at - rule.limit_window_hours! * 3_600_000;
      while (start < paidAt.length && paidAt[start]! <= cutoff) start++;
      if (paidAt.length - start >= rule.limit_count) continue;
    }
    paidAt.push(row.at);
  }
  return paidAt.length * rule.amount;
}

interface Counted {
  userId: number;
  total: number;
  byTrigger: Map<Trigger, number>;
}

function countMember(ctx: Ctx, userId: number, rules: Plan[], from: number): Counted {
  const byTrigger = new Map<Trigger, number>();
  let total = 0;
  for (const plan of rules) {
    const amount = rulePays(ctx, plan, userId, from);
    if (amount === 0) continue;
    total += amount;
    byTrigger.set(plan.rule.trigger, (byTrigger.get(plan.rule.trigger) ?? 0) + amount);
  }
  return { userId, total, byTrigger };
}

/** The nearest-rank percentile of values sorted from low to high. */
const percentile = (sorted: number[], p: number) =>
  sorted.length ? sorted[Math.ceil((p / 100) * sorted.length) - 1]! : 0;

function summarize(ctx: Ctx, row: RunRow, byTrigger: Record<string, number>): Summary {
  const results = sql<{ user_id: number; total: number; paid: number }>(
    ctx,
    "results",
    backfillSql.results,
  ).all(row.id);
  const paid = results.filter((result) => result.paid > 0);
  const amounts = paid.map((result) => result.paid).sort((a, b) => a - b);
  return {
    members: paid.length,
    credits: amounts.reduce((sum, amount) => sum + amount, 0),
    heldAtCap: results.filter((result) => result.total > row.cap).length,
    byTrigger,
    paid: {
      p50: percentile(amounts, 50),
      p90: percentile(amounts, 90),
      p99: percentile(amounts, 99),
      max: amounts.at(-1) ?? 0,
    },
    top: paid
      .sort((a, b) => b.paid - a.paid || b.total - a.total || a.user_id - b.user_id)
      .slice(0, 20)
      .map((result) => ({ userId: result.user_id, total: result.total, paid: result.paid })),
  };
}

/** Whether the administrator who started the run still holds `admin.creditRules`, as the database says now. */
function mayManage(ctx: Ctx, adminId: number): boolean {
  try {
    return can(
      ctx,
      currentActor(ctx, { kind: "user", userId: adminId, groupId: 0, sessionId: 0 }),
      "admin.creditRules",
    );
  } catch (error) {
    // Only a member who is gone has lost the permission; any other error is the chunk's.
    if (error instanceof UnauthenticatedError) return false;
    throw error;
  }
}

/**
 * Records each counted member of the chunk: what they are paid is their total up to the cap, less
 * what earlier payments of past activity paid them, read in this transaction. An apply pays it in
 * one ledger row in the transaction that records the member, so a member is paid once even when
 * the chunk runs again.
 */
function record(ctx: Ctx, row: RunRow, counted: Counted[], byTrigger: Record<string, number>) {
  for (const member of counted) {
    for (const [trigger, amount] of member.byTrigger)
      byTrigger[trigger] = (byTrigger[trigger] ?? 0) + amount;
    if (member.total <= 0) continue;
    const earlier = one<{ paid: number }>(ctx, "earlier", member.userId)!.paid;
    const paid = Math.max(0, Math.min(member.total, row.cap) - earlier);
    const inserted = one(ctx, "result", row.id, member.userId, member.total, paid);
    if (inserted && paid > 0 && row.mode === "apply")
      moveCredits(ctx, [
        {
          userId: member.userId,
          amount: paid,
          type: "backfill",
          source: { type: "credit_backfill", id: row.id },
        },
      ]);
  }
}

/** The members of the chunk after `after`, when the run is the one under way at that point. */
function pageOf(ctx: Ctx, seen: RunRow | null, after: number): number[] {
  if (seen?.state !== "running" || seen.last_user_id !== after) return [];
  return sql<{ id: number }>(ctx, "members", backfillSql.members)
    .all(after, BACKFILL_CHUNK)
    .map((member) => member.id);
}

/**
 * The transaction of a chunk: completes the job, checks the run still matches it and that its
 * starter may still manage credit rules, records (and an apply pays) the counted members, then
 * queues the next chunk or finishes the run with its figures.
 */
function commitChunk(
  ctx: Ctx,
  runId: number,
  after: number,
  job: ClaimedJob,
  page: number[],
  counted: Counted[],
): void {
  if (!completeRunningJob(ctx, job)) return;
  const current = one<RunRow>(ctx, "run", runId);
  if (current?.state !== "running") return;
  if (current.last_user_id !== after) return void run(ctx, "fail", runId, "mismatch", ctx.now());
  if (!mayManage(ctx, current.started_by))
    return void run(ctx, "fail", runId, "permission", ctx.now());
  const byTrigger = JSON.parse(current.by_trigger) as Record<string, number>;
  record(ctx, current, counted, byTrigger);
  const last = page.at(-1) ?? after;
  const totals = JSON.stringify(byTrigger);
  if (page.length < BACKFILL_CHUNK) {
    const summary = JSON.stringify(summarize(ctx, current, byTrigger));
    run(ctx, "finish", runId, last, totals, summary, ctx.now());
    return;
  }
  run(ctx, "advance", runId, last, totals, ctx.now());
  enqueueJob(ctx, BACKFILL_JOB, { runId, after: last }, { uniqueKey: BACKFILL_JOB });
}

/**
 * Counts one page of members after `after` with the rules the run started with, a member at a
 * time with a turn of the event loop after each; then one transaction (`commitChunk`) records
 * them and commits together with the job's completion and its successor.
 */
export async function backfillChunk(
  ctx: Ctx,
  runId: number,
  after: number,
  job: ClaimedJob,
): Promise<void> {
  const seen = one<RunRow>(ctx, "run", runId) ?? null;
  const page = pageOf(ctx, seen, after);
  const rules = seen ? plans(seen) : [];
  const counted: Counted[] = [];
  for (const userId of page) {
    counted.push(countMember(ctx, userId, rules, seen?.from_at ?? 0));
    await nextTurn();
  }
  await paceWal(ctx);
  const release = holdCheckpoints(ctx);
  try {
    writeTx(ctx, () => commitChunk(ctx, runId, after, job, page, counted));
  } finally {
    release();
  }
}

export function registerBackfillJobs(ctx: Ctx): void {
  registerJobHandler(
    ctx,
    BACKFILL_JOB,
    async (context, payload, job) => {
      const { runId, after } = payload as { runId: number; after: number };
      await backfillChunk(context, runId, after, job);
    },
    {
      holdCheckpoints: false,
      // A run that keeps failing stops; a new preview starts over. The error itself stays in the
      // job's row.
      onFailed: (context, { payload }) => {
        const { runId } = payload as { runId: number };
        run(context, "fail", runId, "error", context.now());
      },
    },
  );
}
