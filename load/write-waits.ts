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
// timeout fails and shows as a locked-database line.

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
  process.exit(0);
}

const from = Number(values.from);
const lines = readFileSync(log).subarray(from).toString("utf8").split("\n");
const slow = lines
  .map((line) => /^\[db\.write-wait\] at=\S+ wait=(\d+) hold=(\d+) commit=(\d+)/.exec(line))
  .filter((match) => match !== null)
  .map((match) => ({ wait: Number(match[1]), hold: Number(match[2]), commit: Number(match[3]) }));
const locked = lines.filter((line) => /database is locked|SQLITE_BUSY/i.test(line));
const failures = lines.filter((line) => line.includes("API request failed"));
const size = (file: string) => (existsSync(file) ? statSync(file).size : 0);
const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

function summary(name: "wait" | "hold" | "commit"): string {
  const sorted = slow.map((entry) => entry[name]).sort((a, b) => a - b);
  if (sorted.length === 0) return `${name}: none`;
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  return `${name}: p95 ${p95} ms, max ${sorted[sorted.length - 1]} ms`;
}

console.log(`backend log after byte ${from}: ${lines.length} lines`);
console.log(`slow writes (wait or commit of 100 ms or more): ${slow.length}`);
if (slow.length > 0) {
  console.log(`  ${summary("wait")}`);
  console.log(`  ${summary("hold")}`);
  console.log(`  ${summary("commit")}`);
  console.log("  (over the slow writes only; a fast write is not logged)");
}
console.log(`locked-database lines: ${locked.length}`);
console.log(`failed requests logged: ${failures.length}`);
for (const line of locked.slice(0, 3)) console.log(`  ${line.slice(0, 200)}`);
console.log(`write-ahead log now: ${mib(size(`${db}-wal`))} (database ${mib(size(db))})`);
