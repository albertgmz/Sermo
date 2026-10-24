import { registerJobHandlers, runDueJobs } from "@sermo/core";
import { LEGACY_POST_QUOTE } from "../../packages/core/src/bbcode/legacy-quotes";
import {
  QUOTE_HEADERS_CHUNK,
  QUOTE_HEADERS_JOB,
} from "../../packages/core/src/modules/jobs/quote-headers";
import type { BenchEnv, Scenario } from "../harness";

/** Windows made of old quotes only: the measured chunks and the warm-up ones, with room to spare. */
const WINDOWS = 30;
const RECORD_KEY = "bbcode.quoteHeaders";

let saved: { post_id: number; body_html: string }[] = [];

/**
 * The newest posts, `WINDOWS` windows of them, each given a quote of a post as it was stored before
 * (an English "wrote:" header), and the walk set to start at them: every chunk rewrites a full
 * window, the most a chunk can do. The bodies come back as they were afterwards.
 */
function startWalk(env: BenchEnv): void {
  const db = env.ctx.sqlite;
  registerJobHandlers(env.ctx);
  const start = db
    .prepare<{ post_id: number }, [number]>(
      "SELECT post_id FROM post_bodies ORDER BY post_id DESC LIMIT 1 OFFSET ?1",
    )
    .get(WINDOWS * QUOTE_HEADERS_CHUNK)!.post_id;
  saved = db
    .prepare<{ post_id: number; body_html: string }, [number]>(
      "SELECT post_id, body_html FROM post_bodies WHERE post_id > ?1 ORDER BY post_id",
    )
    .all(start);
  const update = db.prepare("UPDATE post_bodies SET body_html = ?1 WHERE post_id = ?2");
  db.transaction(() => {
    for (const row of saved)
      update.run(
        `${LEGACY_POST_QUOTE}${row.post_id - 1}"><cite><a href="/posts/${row.post_id - 1}" rel="nofollow ugc noopener">member${row.post_id % 997}</a> wrote:</cite>The quoted text, as long as a short reply usually is.</blockquote>${row.body_html}`,
        row.post_id,
      );
    db.prepare("DELETE FROM jobs WHERE type = ?1").run(QUOTE_HEADERS_JOB);
    db.prepare(
      "INSERT INTO site_settings (key, value, updated_at) VALUES (?1, ?2, 0) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    ).run(RECORD_KEY, JSON.stringify({ stage: 0, after: start }));
    db.prepare(
      "INSERT INTO jobs (type, payload, run_at, unique_key, created_at, updated_at) VALUES (?1, '{}', 0, ?1, 0, 0)",
    ).run(QUOTE_HEADERS_JOB);
  })();
}

/** One chunk: its pause before the next one is skipped, so each iteration takes one window. */
async function oneChunk(env: BenchEnv): Promise<void> {
  env.ctx.sqlite
    .prepare("UPDATE jobs SET run_at = 0 WHERE type = ?1 AND status = 'pending'")
    .run(QUOTE_HEADERS_JOB);
  if (!(await runDueJobs(env.ctx, { limit: 1 })))
    throw new Error("The quote header walk had no chunk to take.");
}

function endWalk(env: BenchEnv): void {
  const db = env.ctx.sqlite;
  const left = db
    .prepare<{ n: number }, [number, string]>(
      "SELECT count(*) AS n FROM post_bodies WHERE post_id > ?1 AND instr(body_html, ?2) > 0",
    )
    .get(saved[0]!.post_id - 1, LEGACY_POST_QUOTE)!.n;
  if (left === saved.length) throw new Error("The quote header walk rewrote nothing.");
  const restore = db.prepare("UPDATE post_bodies SET body_html = ?1 WHERE post_id = ?2");
  db.transaction(() => {
    for (const row of saved) restore.run(row.body_html, row.post_id);
    db.prepare("DELETE FROM jobs WHERE type = ?1").run(QUOTE_HEADERS_JOB);
    db.prepare("DELETE FROM site_settings WHERE key = ?1").run(RECORD_KEY);
  })();
  saved = [];
}

export const scenarios: Scenario[] = [
  {
    // One chunk of the walk (one transaction): 1,000 post bodies read, every one rewritten.
    name: "jobs quote headers chunk, every body an old quote",
    kind: "write",
    iterations: 20,
    setup: startWalk,
    run: (env) => oneChunk(env),
    teardown: endWalk,
  },
];
