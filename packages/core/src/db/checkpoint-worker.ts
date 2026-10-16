/// <reference lib="webworker" />
/** Worker thread for startCheckpointer: periodic PASSIVE checkpoints on its own connection. */
import { Database } from "bun:sqlite";
import { CAUGHT_UP, COPIED, HOLDS, PACE_WAITING, RUNNING } from "./checkpoint-state";

declare const self: Worker;

type Message =
  | { type: "start"; path: string; intervalMs: number; maxHoldMs: number; state: Int32Array }
  | { type: "stop" };

/** How often a job waiting for a checkpoint (`paceWal`) is looked for. */
const PACE_POLL_MS = 20;

let db: Database | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let paceTimer: ReturnType<typeof setInterval> | undefined;

self.onmessage = (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.type === "start") {
    db = new Database(message.path);
    db.run("PRAGMA busy_timeout = 5000");
    db.run("PRAGMA wal_autocheckpoint = 0");
    const { state, maxHoldMs } = message;
    let lastCheckpoint = performance.now();
    let lastLog = Number.POSITIVE_INFINITY;
    let started = 0;
    const checkpoint = () => {
      Atomics.store(state, RUNNING, ++started);
      let result: { busy: number; log: number; checkpointed: number } | undefined;
      try {
        result = db?.query("PRAGMA wal_checkpoint(PASSIVE)").get() as typeof result;
      } finally {
        Atomics.store(state, RUNNING, 0);
      }
      // A busy checkpoint (another checkpoint or a lock held) did nothing: try again next tick.
      if (!result || result.busy || result.log < 0) return;
      Atomics.store(state, COPIED, result.checkpointed);
      // Every frame copied: the next write restarts the WAL. Jobs waiting in `paceWal` count these.
      if (result.checkpointed >= result.log) Atomics.add(state, CAUGHT_UP, 1);
      // The WAL restarts (stops growing) only when a write finds every frame checkpointed. Until a
      // complete checkpoint sees the WAL no longer than the previous one did, writes are
      // overtaking checkpoints: keep checkpointing every tick instead of waiting for the next hold.
      if (result.checkpointed >= result.log && result.log <= lastLog)
        lastCheckpoint = performance.now();
      lastLog = result.log;
    };
    timer = setInterval(() => {
      // Holds delay checkpoints, but never past maxHoldMs since the last complete one: back-to-back
      // jobs can keep a hold active indefinitely.
      if (Atomics.load(state, HOLDS) > 0 && performance.now() - lastCheckpoint < maxHoldMs) return;
      checkpoint();
    }, message.intervalMs);
    // A job that stopped writing so the WAL can restart wants a checkpoint now, holds or not. The
    // job commits nothing meanwhile (requests still can, as they can beside any checkpoint).
    paceTimer = setInterval(() => {
      if (Atomics.load(state, PACE_WAITING) > 0) checkpoint();
    }, PACE_POLL_MS);
  } else {
    clearInterval(timer);
    clearInterval(paceTimer);
    db?.close(true);
    db = undefined;
    self.postMessage("stopped");
  }
};
