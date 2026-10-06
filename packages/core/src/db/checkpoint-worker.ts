/// <reference lib="webworker" />
/** Worker thread for startCheckpointer: periodic PASSIVE checkpoints on its own connection. */
import { Database } from "bun:sqlite";

declare const self: Worker;

type Message =
  | { type: "start"; path: string; intervalMs: number; maxHoldMs: number; state: Int32Array }
  | { type: "stop" };

let db: Database | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

self.onmessage = (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.type === "start") {
    db = new Database(message.path);
    db.run("PRAGMA busy_timeout = 5000");
    db.run("PRAGMA wal_autocheckpoint = 0");
    const { state, maxHoldMs } = message;
    let lastCheckpoint = performance.now();
    let lastLog = Number.POSITIVE_INFINITY;
    timer = setInterval(() => {
      // Holds delay checkpoints, but never past maxHoldMs since the last complete one: back-to-back
      // jobs can keep a hold active indefinitely.
      if (Atomics.load(state, 0) > 0 && performance.now() - lastCheckpoint < maxHoldMs) return;
      const result = db?.query("PRAGMA wal_checkpoint(PASSIVE)").get() as
        | { busy: number; log: number; checkpointed: number }
        | undefined;
      // The WAL restarts (stops growing) only when a write finds every frame checkpointed. Until a
      // complete checkpoint sees the WAL no longer than the previous one did, writes are
      // overtaking checkpoints: keep checkpointing every tick instead of waiting for the next hold.
      // A busy checkpoint (another checkpoint or a lock held) did nothing: try again next tick.
      if (!result || result.busy || result.log < 0) return;
      if (result.checkpointed >= result.log && result.log <= lastLog)
        lastCheckpoint = performance.now();
      lastLog = result.log;
    }, message.intervalMs);
  } else {
    clearInterval(timer);
    db?.close(true);
    db = undefined;
    self.postMessage("stopped");
  }
};
