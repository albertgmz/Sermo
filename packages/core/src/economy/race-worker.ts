import { parentPort, workerData } from "node:worker_threads";
import { closeContext, createContext } from "../context";
import { ConflictError } from "../errors";
import { registerCreditJobs } from "../modules/credits";
import { runDueJobs } from "../modules/jobs/queue";
import { registerShopJobs } from "../modules/shop";
import { execute } from "../operation";
import { getOperation } from "../operations";
import type { RaceInput, RaceResult } from "./race";

const input = workerData as RaceInput;
const ctx = createContext({
  path: input.path,
  now: () => input.now,
  config: { validateOutput: true },
});
registerCreditJobs(ctx);
registerShopJobs(ctx);
let completed = 0;
try {
  parentPort!.postMessage("ready");
  if (Atomics.wait(new Int32Array(input.gate), 0, 0, 8000) === "timed-out")
    throw new Error("Start gate timed out");
  const task = input.task;
  if (task.kind === "jobs") {
    for (let batch = 0; batch < 100; batch++) {
      const ran = await runDueJobs(ctx, { limit: 1 });
      completed += ran;
      if (!ran) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    const unfinished = ctx.sqlite
      .prepare("SELECT type, status, last_error FROM jobs WHERE status != 'done'")
      .all();
    if (unfinished.length) throw new Error(`Jobs did not finish: ${JSON.stringify(unfinished)}`);
  } else {
    for (let i = 0; i < (task.repetitions ?? 1); i++) {
      await execute(ctx, getOperation(task.name), task.actor, task.input);
      completed++;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  parentPort!.postMessage({ status: "ok", completed } satisfies RaceResult);
} catch (error) {
  if (!(error instanceof ConflictError)) throw error;
  parentPort!.postMessage({ status: "conflict", completed } satisfies RaceResult);
} finally {
  closeContext(ctx);
  parentPort!.close();
}
