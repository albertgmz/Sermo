import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
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
    "With the server's environment, run: bun run images:widths\nMakes the 640 and 1280 pixel copies of attachment pictures uploaded before they existed. Safe while the server runs; run it again to continue after an interruption, or pass --after <file id> to start after a picture.",
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
const tempDir = join(dirname(config.path), "image-widths-temp");
const ctx = createContext({ path: config.path });
const started = performance.now();
try {
  const result = await backfillWidthCopies(ctx, driver, {
    tempDir,
    after,
    batchSize: values["batch-size"] === undefined ? 100 : Number(values["batch-size"]),
    onProgress(progress) {
      if (progress.pictures % 100 === 0)
        console.log(
          `${progress.pictures} pictures, ${progress.created} copies, through file ${progress.lastFileId}.`,
        );
    },
  });
  const seconds = (performance.now() - started) / 1000;
  console.log(
    `Complete: ${result.pictures} pictures read, ${result.created} copies made, ${result.animated} animations passed over, in ${seconds.toFixed(1)} s.`,
  );
} catch (error) {
  console.error(
    `Stopped: ${(error as Error).message} Run the command again to continue, or with --after <file id> to pass a picture over.`,
  );
  throw error;
} finally {
  closeContext(ctx);
  await rm(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
