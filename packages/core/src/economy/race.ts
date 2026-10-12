import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import type { Actor } from "../actor";
import { type Ctx, closeContext, createContext } from "../context";
import { registerAwardJobs } from "../modules/awards";
import { registerCreditRuleJobs } from "../modules/credit-events";

export type RaceTask =
  | { kind: "operation"; name: string; actor: Actor; input: unknown; repetitions?: number }
  | { kind: "jobs" };
export type RaceResult = { status: "ok" | "conflict"; completed: number };
export type RaceInput = { path: string; now: number; gate: SharedArrayBuffer; task: RaceTask };

/** Each worker opens a separate connection before any contender may start its transaction. */
export async function race(
  fixture: Ctx,
  tasks: RaceTask[],
  inspect: (ctx: Ctx, results: RaceResult[]) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "sermo-economy-race-"));
  const path = join(directory, "economy.db");
  const workers: Worker[] = [];
  let observer: Ctx | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    writeFileSync(path, fixture.sqlite.serialize());
    closeContext(createContext({ path }));
    const gate = new SharedArrayBuffer(4);
    const results: Promise<RaceResult>[] = [];
    const ready: Promise<void>[] = [];
    for (const task of tasks) {
      const worker = new Worker(new URL("./race-worker.ts", import.meta.url), {
        workerData: { path, gate, now: fixture.now(), task } satisfies RaceInput,
      });
      workers.push(worker);
      const started = Promise.withResolvers<void>();
      ready.push(started.promise);
      results.push(
        new Promise((resolve, reject) => {
          let result: RaceResult | undefined;
          let failure: unknown;
          worker.on("message", (message) => {
            if (message === "ready") started.resolve();
            else result = message as RaceResult;
          });
          worker.on("error", (error) => {
            failure = error;
          });
          worker.on("exit", (code) => {
            // Unblock the gate coordinator on early startup failure, then report it via results.
            started.resolve();
            if (failure || code !== 0 || !result)
              reject(failure ?? new Error(`Worker exited ${code} without a result`));
            else resolve(result);
          });
        }),
      );
      // Opening several connections to a WAL file at once can fail with SQLITE_BUSY_RECOVERY
      // (the journal_mode pragma runs before the busy timeout), so open them one at a time.
      results.at(-1)!.catch(() => {});
      await started.promise;
    }
    // Attach result handlers immediately, including workers that fail before reaching the gate.
    const finished = Promise.all(results);
    const run = Promise.all([
      finished,
      Promise.all(ready).then(() => {
        Atomics.store(new Int32Array(gate), 0, 1);
        Atomics.notify(new Int32Array(gate), 0, tasks.length);
      }),
    ]).then(([values]) => values);
    const values = await Promise.race([
      run,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Economy workers exceeded 10 seconds")), 10_000);
      }),
    ]);
    clearTimeout(timer);
    observer = createContext({ path, now: fixture.now, config: { validateOutput: true } });
    registerCreditRuleJobs(observer);
    registerAwardJobs(observer);
    await inspect(observer, values);
  } finally {
    clearTimeout(timer);
    await Promise.all(workers.map((worker) => worker.terminate()));
    if (observer) closeContext(observer);
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
}
