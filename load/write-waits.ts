import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

// What the staging backend log says about database write waits after a load run.
//
//   bun load/write-waits.ts --db <path> --size          the log's size in bytes (note it before the run)
//   bun load/write-waits.ts --db <path> [--from <n>]    lines written after byte <n> that report a
//                                                       locked database, and the WAL's size now
//
// The backend logs a failure, not a wait: a write that waited past its 5 s busy timeout fails with
// "database is locked" and shows up here; a write that waited less is not recorded anywhere.

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
const text = readFileSync(log).subarray(from).toString("utf8");
const lines = text.split("\n");
const locked = lines.filter((line) => /database is locked|SQLITE_BUSY/i.test(line));
const failures = lines.filter((line) => line.includes("API request failed"));
const size = (file: string) => (existsSync(file) ? statSync(file).size : 0);
const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`;

console.log(`backend log after byte ${from}: ${lines.length} lines`);
console.log(`locked-database lines: ${locked.length}`);
console.log(`failed requests logged: ${failures.length}`);
for (const line of locked.slice(0, 3)) console.log(`  ${line.slice(0, 200)}`);
console.log(`write-ahead log now: ${mib(size(`${db}-wal`))} (database ${mib(size(db))})`);
