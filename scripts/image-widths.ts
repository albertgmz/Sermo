import { randomUUID } from "node:crypto";
import { existsSync, rmdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  backfillWidthCopies,
  closeContext,
  createContext,
  localDriver,
  s3Driver,
} from "@sermo/core";
import { readConfiguration } from "../packages/api/src/server";

const { values } = parseArgs({
  options: {
    after: { type: "string" },
    "batch-size": { type: "string" },
    help: { type: "boolean" },
  },
});

if (values.help) {
  console.log(
    "With the server's environment, run: bun run images:widths\nMakes the 640 and 1280 pixel copies of attachment pictures uploaded before they existed. Run it with the server running: its checkpointer keeps the database log small, while with the server stopped the log is folded back only when the run ends. Run it again to continue after an interruption, or pass --after <file id> to start after a picture. Exits non-zero if any picture could not be read or the run stopped.",
  );
  process.exit(0);
}

const config = readConfiguration();
if (!existsSync(config.path)) throw new Error(`Database does not exist: ${config.path}`);
const { storage } = config;
const driver =
  storage.driver === "local"
    ? localDriver(storage.directory)
    : s3Driver({
        bucket: storage.bucket!,
        ...(storage.endpoint ? { endpoint: storage.endpoint } : {}),
        ...(storage.region ? { region: storage.region } : {}),
        ...(storage.accessKeyId ? { accessKeyId: storage.accessKeyId } : {}),
        ...(storage.secretAccessKey ? { secretAccessKey: storage.secretAccessKey } : {}),
      });
const after = values.after === undefined ? 0 : Number(values.after);
if (!Number.isSafeInteger(after) || after < 0) throw new Error("--after takes a file id.");
// Its own folder, so that a second run beside it does not remove what this one is working on.
const tempRoot = join(dirname(config.path), "image-widths-temp");
const tempDir = join(tempRoot, randomUUID());
const removeTemp = () => {
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  try {
    // Left in place while another run uses it.
    rmdirSync(tempRoot);
  } catch {}
};
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    removeTemp();
    console.error(`Stopped by ${signal}. Run the command again to continue.`);
    process.exit(1);
  });
const ctx = createContext({ path: config.path });
// The server's checkpointer folds the log back; a commit of this run must not be the one that
// crosses SQLite's own threshold and checkpoints inline, stalling the server's commits. With the
// server stopped the log grows until the run ends and closes the database, which folds it.
ctx.sqlite.run("PRAGMA wal_autocheckpoint = 0");
console.log(
  "Making the width copies of older pictures. With the server stopped, the database log is folded back only when this run ends.",
);
const started = performance.now();
try {
  const result = await backfillWidthCopies(ctx, driver, {
    tempDir,
    after,
    batchSize: values["batch-size"] === undefined ? 100 : Number(values["batch-size"]),
    onSkip(fileId, reason) {
      console.warn(`Passed over file ${fileId}: ${reason}.`);
    },
    onProgress(progress) {
      if (progress.pictures % 100 === 0)
        console.log(
          `${progress.pictures} pictures, ${progress.created} copies, through file ${progress.lastFileId}.`,
        );
    },
  });
  const seconds = (performance.now() - started) / 1000;
  console.log(
    `Complete: ${result.pictures} pictures read, ${result.created} copies made, ${result.animated} animations need none, ${result.deleted} deleted meanwhile, ${result.skipped} could not be read, in ${seconds.toFixed(1)} s.`,
  );
  if (result.skipped) {
    console.error(
      `${result.skipped} pictures could not be read (listed above). The next run reads them again; pass --after <file id> to start after them.`,
    );
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    `Stopped: ${(error as Error).message} Run the command again to continue, or with --after <file id> to pass a picture over.`,
  );
  throw error;
} finally {
  closeContext(ctx);
  removeTemp();
}
