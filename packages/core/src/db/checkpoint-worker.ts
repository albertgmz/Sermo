/// <reference lib="webworker" />
/** Worker thread for startCheckpointer: periodic PASSIVE checkpoints on its own connection. */
import { Database } from "bun:sqlite";

declare const self: Worker;

type Message = { type: "start"; path: string; intervalMs: number } | { type: "stop" };

let db: Database | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

self.onmessage = (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.type === "start") {
    db = new Database(message.path);
    db.run("PRAGMA busy_timeout = 5000");
    db.run("PRAGMA wal_autocheckpoint = 0");
    timer = setInterval(() => db?.run("PRAGMA wal_checkpoint(PASSIVE)"), message.intervalMs);
  } else {
    clearInterval(timer);
    db?.close(true);
    db = undefined;
    self.postMessage("stopped");
  }
};
