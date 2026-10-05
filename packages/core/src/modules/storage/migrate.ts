import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { writeTx } from "../../db/tx";
import type { StorageDriver } from ".";

type FileToCopy = {
  id: number;
  storage_key: string;
  byte_size: number;
  sha256: string;
  content_type: string;
};
export interface StorageMigrationProgress {
  copied: number;
  reused: number;
  bytes: number;
  lastFileId: number;
}

async function hashBlob(blob: Blob): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of Readable.fromWeb(blob.stream() as never)) {
    const value = chunk as Buffer;
    bytes += value.byteLength;
    hash.update(value);
  }
  return { bytes, sha256: hash.digest("hex") };
}

async function spool(blob: Blob, path: string): Promise<{ bytes: number; sha256: string }> {
  const hash = createHash("sha256");
  let bytes = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(blob.stream() as never),
    meter,
    createWriteStream(path, { flags: "wx" }),
  );
  return { bytes, sha256: hash.digest("hex") };
}

function assertHash(
  row: FileToCopy,
  actual: { bytes: number; sha256: string },
  location: string,
): void {
  if (actual.bytes !== row.byte_size || actual.sha256 !== row.sha256)
    throw new Error(
      `File ${row.id} ${location} differs from its database hash; migration stopped.`,
    );
}

/** Offline, per-file copy. A restarted run selects only rows still assigned to the source driver. */
export async function migrateStorageFiles(
  ctx: Ctx,
  from: StorageDriver,
  to: StorageDriver,
  options: {
    tempDir: string;
    batchSize?: number;
    onProgress?: (progress: StorageMigrationProgress) => void;
  },
): Promise<StorageMigrationProgress> {
  if (from.name === to.name) throw new Error("Source and destination drivers must differ.");
  if (!to.exists) throw new Error("The destination driver must support existence checks.");
  const batchSize = options.batchSize ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new RangeError("Batch size must be between 1 and 1000.");
  await mkdir(options.tempDir, { recursive: true });
  const page = prepared(ctx, "storageMigration.page", () =>
    ctx.sqlite.prepare<FileToCopy, [string, number, number]>(
      "SELECT id,storage_key,byte_size,sha256,content_type FROM files WHERE driver=?1 AND deleted_at IS NULL AND id>?2 ORDER BY id LIMIT ?3",
    ),
  );
  const switchDriver = prepared(ctx, "storageMigration.switch", () =>
    ctx.sqlite.prepare(
      "UPDATE files SET driver=?1 WHERE id=?2 AND driver=?3 AND storage_key=?4 AND deleted_at IS NULL",
    ),
  );
  const progress: StorageMigrationProgress = { copied: 0, reused: 0, bytes: 0, lastFileId: 0 };
  let after = 0;
  for (;;) {
    const rows = page.all(from.name, after, batchSize);
    if (!rows.length) return progress;
    for (const row of rows) {
      const existing = await to.exists(row.storage_key);
      if (existing) {
        assertHash(row, await hashBlob(to.read(row.storage_key)), "at destination");
        progress.reused++;
      } else {
        const tempPath = join(options.tempDir, `${randomUUID()}.tmp`);
        try {
          assertHash(row, await spool(from.read(row.storage_key), tempPath), "at source");
          await to.put(row.storage_key, tempPath, row.content_type);
          assertHash(row, await hashBlob(to.read(row.storage_key)), "at destination");
          progress.copied++;
        } finally {
          await rm(tempPath, { force: true });
        }
      }
      writeTx(ctx, () => {
        const result = switchDriver.run(to.name, row.id, from.name, row.storage_key);
        if (result.changes !== 1)
          throw new Error(`File ${row.id} changed during migration; stop all writers and retry.`);
      });
      progress.bytes += row.byte_size;
      progress.lastFileId = row.id;
      options.onProgress?.({ ...progress });
      after = row.id;
    }
  }
}
