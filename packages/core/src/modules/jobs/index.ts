import type { Ctx } from "../../context";
import type { AnyOperation } from "../../operation";
import { startJobWorker as startPollingWorker } from "./queue";
import { registerJobHandlers } from "./rebuild";

export const operations: AnyOperation[] = [];
export type { ClaimedJob, EnqueueOptions, JobFailureHook, JobHandler } from "./queue";
export {
  completeRunningJob,
  enqueueJob,
  flushActivity,
  flushDownloadCounts,
  flushViewCounts,
  registerJobHandler,
  runDueJobs,
} from "./queue";
export { type RebuildProgress, rebuildCountersChunk, registerJobHandlers } from "./rebuild";
export { startScheduler } from "./scheduler";

export function startJobWorker(ctx: Ctx, options?: { pollMs?: number }): () => void {
  registerJobHandlers(ctx);
  return startPollingWorker(ctx, options);
}
