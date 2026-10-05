import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import {
  closeContext,
  createContext,
  localDriver,
  migrateStorageFiles,
  s3Driver,
} from "@sermo/core";

const { values } = parseArgs({
  options: {
    from: { type: "string" },
    to: { type: "string" },
    "batch-size": { type: "string" },
    "temp-dir": { type: "string" },
    help: { type: "boolean" },
  },
});

if (values.help) {
  console.log(
    "Stop the Sermo server, then run: bun run storage:migrate --from local --to s3\nThe command verifies and switches each file record. Rerun the same command after an interruption.",
  );
  process.exit(0);
}
if (
  (values.from !== "local" && values.from !== "s3") ||
  (values.to !== "local" && values.to !== "s3") ||
  values.from === values.to
)
  throw new Error("Pass distinct --from and --to drivers: local or s3.");

const dbPath = process.env.SERMO_DB_PATH ?? "./data/sermo.db";
if (!existsSync(dbPath)) throw new Error(`Database does not exist: ${dbPath}`);
const localPath = process.env.SERMO_FILES_DIR || join(dirname(dbPath), "files");
const s3 = () => {
  const bucket = process.env.SERMO_S3_BUCKET;
  if (!bucket) throw new Error("SERMO_S3_BUCKET is required for S3 migration.");
  return s3Driver({
    bucket,
    ...(process.env.SERMO_S3_ENDPOINT ? { endpoint: process.env.SERMO_S3_ENDPOINT } : {}),
    ...(process.env.SERMO_S3_REGION ? { region: process.env.SERMO_S3_REGION } : {}),
    ...(process.env.SERMO_S3_ACCESS_KEY_ID
      ? { accessKeyId: process.env.SERMO_S3_ACCESS_KEY_ID }
      : {}),
    ...(process.env.SERMO_S3_SECRET_ACCESS_KEY
      ? { secretAccessKey: process.env.SERMO_S3_SECRET_ACCESS_KEY }
      : {}),
  });
};
const from = values.from === "local" ? localDriver(localPath) : s3();
const to = values.to === "local" ? localDriver(localPath) : s3();
const batchSize = values["batch-size"] === undefined ? 100 : Number(values["batch-size"]);
const tempDir = values["temp-dir"] ?? join(dirname(dbPath), "storage-migrate-temp");
const ctx = createContext({ path: dbPath });
try {
  const pendingDeletion = ctx.sqlite
    .prepare<{ id: number }, [string]>(
      "SELECT id FROM files WHERE driver=?1 AND deleted_at=-1 LIMIT 1",
    )
    .get(from.name);
  if (pendingDeletion)
    throw new Error(
      `File ${pendingDeletion.id} has an unfinished deletion; run pending jobs before migration.`,
    );
  const result = await migrateStorageFiles(ctx, from, to, {
    tempDir,
    batchSize,
    onProgress(progress) {
      if ((progress.copied + progress.reused) % 100 === 0)
        console.log(
          `Switched ${progress.copied + progress.reused} files through id ${progress.lastFileId}.`,
        );
    },
  });
  const remaining =
    ctx.sqlite
      .prepare<{ n: number }, [string]>(
        "SELECT count(*) AS n FROM files WHERE driver=?1 AND deleted_at IS NULL",
      )
      .get(from.name)?.n ?? 0;
  if (remaining !== 0)
    throw new Error(`${remaining} live files remain on ${from.name}; rerun the command.`);
  console.log(
    `Complete: copied ${result.copied}, reused ${result.reused}, verified ${result.bytes} bytes. Switch SERMO_STORAGE_DRIVER to ${to.name} before restarting the server.`,
  );
} finally {
  closeContext(ctx);
}
