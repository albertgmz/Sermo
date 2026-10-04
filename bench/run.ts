/**
 * Benchmark runner. Copies the seeded database to a scratch file, runs every scenario found in
 * bench/scenarios/*.ts, prints p50/p95/p99/max per scenario and exits non-zero if any budget is
 * exceeded.
 *
 *   bun bench/run.ts [--only <substring>] [--iterations <n>] [--reuse]
 *
 * --reuse keeps the scratch database from the previous run instead of copying the seed again.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { closeContext, createContext } from "@sermo/core";
import { BUDGETS, createEnv, type Scenario } from "./harness";
import { Rng } from "./rng";
import { benchDir, ensureSeed } from "./seed";

const { values: args } = parseArgs({
  options: {
    only: { type: "string" },
    iterations: { type: "string" },
    reuse: { type: "boolean", default: false },
  },
});

const { path: seedPath, meta } = await ensureSeed();
// One scratch copy per checkout, so benchmarks in parallel worktrees never share a file.
const checkoutId = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 8);
const workPath = join(benchDir(), `work-${checkoutId}.db`);
if (!args.reuse || !existsSync(workPath)) {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(workPath + suffix, { force: true });
  copyFileSync(seedPath, workPath);
}
warmFileCache(workPath);

/**
 * Reads the database file once so the OS page cache holds it, as it would on a server that has
 * been running for a while. Without this the first requests measure disk reads of a file that
 * was copied a moment ago. Cold-start latency is a separate concern and is not what the budgets
 * describe.
 */
function warmFileCache(path: string): void {
  const fd = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  while (readSync(fd, buffer, 0, buffer.length, null) > 0) {}
  closeSync(fd);
}

const ctx = createContext({ path: workPath });
const env = createEnv(ctx, meta, new Rng(42));

const scenarioDir = join(import.meta.dir, "scenarios");
const scenarios: Scenario[] = [];
for (const file of readdirSync(scenarioDir)
  .filter((f) => f.endsWith(".ts"))
  .sort()) {
  const mod = (await import(join(scenarioDir, file))) as { scenarios?: Scenario[] };
  scenarios.push(...(mod.scenarios ?? []));
}
const selected = scenarios.filter((s) => !args.only || s.name.includes(args.only));
if (selected.length === 0) {
  console.error("No scenarios matched.");
  process.exit(1);
}

interface Result {
  name: string;
  kind: "read" | "write";
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  failures: string[];
}
const results: Result[] = [];

for (const scenario of selected) {
  const iterations =
    Number(args.iterations ?? 0) || scenario.iterations || (scenario.kind === "read" ? 200 : 100);
  await scenario.setup?.(env);
  const warmup = Math.min(20, Math.ceil(iterations / 5));
  for (let i = 0; i < warmup; i++) await scenario.run(env, iterations + i);
  Bun.gc(true);
  const times = new Float64Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await scenario.run(env, i);
    times[i] = performance.now() - start;
  }
  times.sort();
  const q = (p: number) => times[Math.min(iterations - 1, Math.ceil(p * iterations) - 1)]!;
  const r: Result = {
    name: scenario.name,
    kind: scenario.kind,
    n: iterations,
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    max: times[iterations - 1]!,
    failures: [],
  };
  const p95Budget = scenario.kind === "read" ? BUDGETS.readP95 : BUDGETS.writeP95;
  if (r.p95 > p95Budget) r.failures.push(`p95 ${r.p95.toFixed(2)} ms > ${p95Budget} ms`);
  if (r.max > BUDGETS.max) r.failures.push(`max ${r.max.toFixed(2)} ms > ${BUDGETS.max} ms`);
  results.push(r);
}
closeContext(ctx);

const pad = (s: string, n: number) => s.padEnd(n);
const num = (x: number) => x.toFixed(2).padStart(8);
const width = Math.max(...results.map((r) => r.name.length), 10) + 2;
console.log(`\n${pad("scenario", width)}kind      n      p50      p95      p99      max`);
for (const r of results) {
  const flag = r.failures.length ? `  FAIL: ${r.failures.join("; ")}` : "";
  console.log(
    `${pad(r.name, width)}${pad(r.kind, 6)}${String(r.n).padStart(5)}${num(r.p50)}${num(r.p95)}${num(r.p99)}${num(r.max)}${flag}`,
  );
}
writeFileSync(
  join(benchDir(), "last-report.json"),
  JSON.stringify({ at: new Date().toISOString(), results }, null, 2),
);

const failed = results.filter((r) => r.failures.length > 0);
if (failed.length > 0) {
  console.error(`\n${failed.length} scenario(s) over budget.`);
  process.exit(1);
}
console.log(
  `\nAll ${results.length} scenarios within budget (reads p95 <= ${BUDGETS.readP95} ms, writes p95 <= ${BUDGETS.writeP95} ms, max <= ${BUDGETS.max} ms).`,
);
