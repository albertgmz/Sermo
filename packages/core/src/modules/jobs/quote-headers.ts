import { LEGACY_POST_QUOTE, upgradePostQuotes } from "../../bbcode/legacy-quotes";
import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { holdCheckpoints, paceWal } from "../../db/checkpointer";
import { writeTx } from "../../db/tx";
import { type ClaimedJob, completeRunningJob, enqueueJob, registerJobHandler } from "./queue";

/**
 * Gives the quotes of posts in stored bodies the header a render writes now (the author, then
 * "said:" in the reader's language) in place of the English "wrote:" they were stored with. Bodies
 * are stored rendered, so years of quoting posts keep the old header until this has passed. It
 * walks each table holding rendered text in id order, a window of rows per chunk, and rewrites only
 * the rows that hold an old quote; the place it reached is kept in `site_settings`, so a stopped or
 * failed run goes on from there when the server next starts, and a finished one never runs again.
 */
export const QUOTE_HEADERS_JOB = "bbcode.quoteHeaders";
/** Rows read per chunk; every one of them may be rewritten. */
export const QUOTE_HEADERS_CHUNK = 1_000;
/** Low priority: the next chunk waits for a later turn of the job worker. */
const PAUSE_MS = 500;
const RECORD_KEY = "bbcode.quoteHeaders";

const TABLES = [
  { table: "post_bodies", id: "post_id", html: "body_html" },
  { table: "post_revisions", id: "id", html: "body_html" },
  { table: "conversation_messages", id: "id", html: "body_html" },
  { table: "profile_posts", id: "id", html: "body_html" },
  { table: "profile_post_comments", id: "id", html: "body_html" },
  // A quote inside a spoiler is stored with the spoiler.
  { table: "content_spoilers", id: "id", html: "html" },
] as const;

type Progress = { stage: number; after: number };
type Walk = Progress | { done: true };

/** The rows of a window, with their HTML only where it holds an old quote of a post. */
export const quoteHeaderWindowSql = (stage: number): string => {
  const { table, id, html } = TABLES[stage]!;
  return `SELECT ${id} AS id, CASE WHEN instr(${html}, ?1) > 0 THEN ${html} END AS html FROM ${table} WHERE ${id} > ?2 ORDER BY ${id} LIMIT ?3`;
};

function readRecord(ctx: Ctx): Walk {
  const row = prepared(ctx, "jobs.quoteHeaders.record", () =>
    ctx.sqlite.prepare<{ value: string }, [string]>(
      "SELECT value FROM site_settings WHERE key = ?1",
    ),
  ).get(RECORD_KEY);
  return row ? (JSON.parse(row.value) as Walk) : { stage: 0, after: 0 };
}

function writeRecord(ctx: Ctx, record: Walk): void {
  prepared(ctx, "jobs.quoteHeaders.setRecord", () =>
    ctx.sqlite.prepare(
      "INSERT INTO site_settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    ),
  ).run(RECORD_KEY, JSON.stringify(record), ctx.now());
}

/**
 * One window of one table, in one transaction that also completes the job and queues the next
 * window (or records the walk finished). Returns how many rows it rewrote.
 */
export async function quoteHeadersChunk(ctx: Ctx, job: ClaimedJob): Promise<number> {
  await paceWal(ctx);
  const release = holdCheckpoints(ctx);
  try {
    return writeTx(ctx, () => {
      if (!completeRunningJob(ctx, job)) return 0;
      const record = readRecord(ctx);
      if ("done" in record) return 0;
      const { stage, after } = record;
      const { table, id, html } = TABLES[stage]!;
      const rows = prepared(ctx, `jobs.quoteHeaders.window.${table}`, () =>
        ctx.sqlite.prepare<{ id: number; html: string | null }, [string, number, number]>(
          quoteHeaderWindowSql(stage),
        ),
      ).all(LEGACY_POST_QUOTE, after, QUOTE_HEADERS_CHUNK);
      const update = prepared(ctx, `jobs.quoteHeaders.update.${table}`, () =>
        ctx.sqlite.prepare(`UPDATE ${table} SET ${html} = ?1 WHERE ${id} = ?2`),
      );
      let rewritten = 0;
      for (const row of rows) {
        if (row.html === null) continue;
        const upgraded = upgradePostQuotes(row.html);
        if (upgraded === row.html) continue;
        update.run(upgraded, row.id);
        rewritten++;
      }
      const next: Walk =
        rows.length === QUOTE_HEADERS_CHUNK
          ? { stage, after: rows.at(-1)!.id }
          : stage + 1 < TABLES.length
            ? { stage: stage + 1, after: 0 }
            : { done: true };
      writeRecord(ctx, next);
      if (!("done" in next))
        enqueueJob(
          ctx,
          QUOTE_HEADERS_JOB,
          {},
          {
            uniqueKey: QUOTE_HEADERS_JOB,
            runAt: ctx.now() + PAUSE_MS,
          },
        );
      return rewritten;
    });
  } finally {
    release();
  }
}

/** Queues the walk unless it has finished; one that is queued or running already is left alone. */
export function scheduleQuoteHeaders(ctx: Ctx): void {
  if ("done" in readRecord(ctx)) return;
  enqueueJob(ctx, QUOTE_HEADERS_JOB, {}, { uniqueKey: QUOTE_HEADERS_JOB });
}

export function registerQuoteHeadersJob(ctx: Ctx): void {
  registerJobHandler(
    ctx,
    QUOTE_HEADERS_JOB,
    async (context, _payload, job) => {
      await quoteHeadersChunk(context, job);
    },
    { holdCheckpoints: false },
  );
}
