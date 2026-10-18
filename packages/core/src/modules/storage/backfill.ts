import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import sharp from "sharp";
import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { ATTACHMENT_WIDTHS, widthCopies } from "../images/process";
import { fileHash, type StorageDriver } from ".";

type Picture = { id: number; storage_key: string; width: number };
export interface WidthBackfillProgress {
  /** Pictures read, with or without new copies. */
  pictures: number;
  /** Copies stored. */
  created: number;
  /** Animations, which get no copies. */
  animated: number;
  /** The last picture done: a run started after it skips what is done. */
  lastFileId: number;
}

const missing = ATTACHMENT_WIDTHS.map(
  (width) =>
    `(f.width > ${width} AND NOT EXISTS (SELECT 1 FROM files v WHERE v.parent_file_id = f.id AND v.variant = 'width_${width}'))`,
).join(" OR ");
/**
 * Still attachment pictures of the driver that lack a width copy they should have, by id. The
 * stored picture of an animation is WebP like any other, so animations are listed (and passed
 * over) until a run starts after them.
 */
const pageSql = `SELECT f.id, f.storage_key, f.width FROM files f WHERE f.driver = ?1 AND f.id > ?2 AND f.purpose = 'attachment' AND f.parent_file_id IS NULL AND f.deleted_at IS NULL AND f.content_type IN ('image/jpeg', 'image/png', 'image/webp') AND (${missing}) ORDER BY f.id LIMIT ?3`;
/**
 * A copy takes its access from its picture at the moment it is written (as an upload's copies
 * do when attached); one already there, or a picture deleted meanwhile, writes nothing.
 */
const insertSql =
  "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, width, height, uploader_id, purpose, visibility, attached_at, parent_file_id, variant, created_at) SELECT ?1, ?2, ?3, 'image/webp', ?4, ?5, ?6, uploader_id, purpose, visibility, attached_at, id, ?7, ?8 FROM files WHERE id = ?9 AND driver = ?1 AND deleted_at IS NULL ON CONFLICT DO NOTHING";

/**
 * Makes the width copies of attachment pictures stored before they existed, from the stored
 * picture. Safe beside a running server: each picture is its own short transaction, and a run
 * stopped anywhere is taken up by running it again (with `after`, from the last picture done).
 */
export async function backfillWidthCopies(
  ctx: Ctx,
  driver: StorageDriver,
  options: {
    tempDir: string;
    batchSize?: number;
    after?: number;
    onProgress?: (progress: WidthBackfillProgress) => void;
  },
): Promise<WidthBackfillProgress> {
  const batchSize = options.batchSize ?? 100;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
    throw new RangeError("Batch size must be between 1 and 1000.");
  await mkdir(options.tempDir, { recursive: true });
  const page = prepared(ctx, "storageBackfill.page", () =>
    ctx.sqlite.prepare<Picture, [string, number, number]>(pageSql),
  );
  const insert = prepared(ctx, "storageBackfill.insert", () => ctx.sqlite.prepare(insertSql));
  const progress: WidthBackfillProgress = {
    pictures: 0,
    created: 0,
    animated: 0,
    lastFileId: options.after ?? 0,
  };
  for (;;) {
    const rows = page.all(driver.name, progress.lastFileId, batchSize);
    if (!rows.length) return progress;
    for (const row of rows) {
      const source = join(options.tempDir, `sermo-backfill-${randomUUID()}`);
      const copies: Awaited<ReturnType<typeof widthCopies>> = [];
      // Stored and not yet in a row: removed again if the picture stops there.
      const pending = new Set<string>();
      try {
        await pipeline(
          Readable.fromWeb(driver.read(row.storage_key).stream() as never),
          createWriteStream(source, { flags: "wx" }),
        );
        if (((await sharp(source).metadata()).pages ?? 1) > 1) progress.animated++;
        else copies.push(...(await widthCopies(source, row.width, options.tempDir)));
        const stored = await Promise.all(
          copies.map(async (copy) => ({
            ...copy,
            storageKey: randomUUID(),
            sha256: await fileHash(copy.path),
          })),
        );
        for (const copy of stored) {
          pending.add(copy.storageKey);
          await driver.put(copy.storageKey, copy.path, copy.contentType);
        }
        const written = writeTx(ctx, () =>
          stored.filter(
            (copy) =>
              insert.run(
                driver.name,
                copy.storageKey,
                copy.byteSize,
                copy.sha256,
                copy.width,
                copy.height,
                copy.variant,
                ctx.now(),
                row.id,
              ).changes === 1,
          ),
        );
        for (const copy of written) pending.delete(copy.storageKey);
        progress.created += written.length;
      } catch (error) {
        throw new Error(`Picture ${row.id} could not be copied.`, { cause: error });
      } finally {
        for (const key of pending) await driver.delete(key).catch(() => {});
        for (const path of [source, ...copies.map((copy) => copy.path)])
          await rm(path, { force: true, maxRetries: 5, retryDelay: 50 });
      }
      progress.pictures++;
      progress.lastFileId = row.id;
      options.onProgress?.({ ...progress });
    }
  }
}
