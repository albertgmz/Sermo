import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

// What the staging backend log says about database write waits after a load run.
//
//   bun load/write-waits.ts --db <path> --size          the log's size in bytes (note it before the run)
//   bun load/write-waits.ts --db <path> [--from <n>]    what the log holds after byte <n>, and the
//                                                       WAL's size now
//
// `writeTx` logs `[db.write-wait] at=<time> wait=<ms> hold=<ms> commit=<ms>` for a write that
// waited for the write lock (wait) or took to commit (commit) for 100 ms or more: fast writes are
// not logged, so the counts below are of slow writes only. A write that waited out its 5 s busy
// timeout fails and is counted as a locked-database failure.

export interface SlowWrite {
  wait: number;
  hold: number;
  commit: number;
}

/**
 * What the backend log holds: the slow writes `writeTx` logged, the failed requests, and how many
 * of those failed on a locked database. Bun prints a failed request's error over several lines
 * (`SQLiteError: database is locked`, then `code: "SQLITE_BUSY"`), so one failure is counted by
 * its first line only.
 */
export function parseLog(text: string): { slow: SlowWrite[]; locked: number; failed: number } {
  const lines = text.split("\n");
  const slow: SlowWrite[] = [];
  for (const line of lines) {
    const match = /^\[db\.write-wait\] at=\S+ wait=(\d+) hold=(\d+) commit=(\d+)/.exec(line);
    if (match)
      slow.push({ wait: Number(match[1]), hold: Number(match[2]), commit: Number(match[3]) });
  }
  return {
    slow,
    locked: lines.filter((line) => /^SQLiteError: database is locked/.test(line)).length,
    failed: lines.filter((line) => line.includes("API request failed")).length,
  };
}

function percentile(sorted: number[], share: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * share) - 1)] ?? 0;
}

function summary(slow: SlowWrite[], name: keyof SlowWrite): string {
  const sorted = slow.map((entry) => entry[name]).sort((a, b) => a - b);
  if (sorted.length === 0) return `${name}: none`;
  return `${name}: p95 ${percentile(sorted, 0.95)} ms, max ${sorted[sorted.length - 1]} ms`;
}

function main() {
  const { values } = parseArgs({
    options: {
      db: { type: "string" },
      from: { type: "string", default: "0" },
      size: { type: "boolean", default: false },
    },
  });
  if (!values.db) {
    console.error("usage: bun load/write-waits.ts --db <path> [--size | --from <bytes>]");
    process.exit(2);
  }

  const db = resolve(values.db);
  const log = join(dirname(db), "staging", "backend.log");
  if (!existsSync(log)) {
    console.error(`no backend log at ${log}`);
    process.exit(1);
  }

  if (values.size) {
    console.log(statSync(log).size);
    return;
  }

  const from = Number(values.from);
  const text = readFileSync(log).subarray(from).toString("utf8");
  const { slow, locked, failed } = parseLog(text);
  const size = (file: string) => (existsSync(file) ? statSync(file).size : 0);
  const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

  console.log(`backend log after byte ${from}: ${text.split("\n").length} lines`);
  console.log(`slow writes (wait or commit of 100 ms or more): ${slow.length}`);
  if (slow.length > 0) {
    for (const name of ["wait", "hold", "commit"] as const) console.log(`  ${summary(slow, name)}`);
    console.log("  (over the slow writes only; a fast write is not logged)");
  }
  console.log(`locked-database failures: ${locked}`);
  console.log(`failed requests logged: ${failed}`);
  console.log(`write-ahead log now: ${mib(size(`${db}-wal`))} (database ${mib(size(db))})`);
}

if (import.meta.main) main();
