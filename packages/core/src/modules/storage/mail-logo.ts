import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { processImage } from "../images/process";
import { fileHash, type StorageConfig } from ".";

const configs = new WeakMap<Ctx, StorageConfig>();
const running = new Map<number, Promise<void>>();
const failed = new Set<number>();

/** Where the stored pictures are, for the mail logo copy made on first use. */
export function rememberStorage(ctx: Ctx, config: StorageConfig): void {
  configs.set(ctx, config);
}

interface Source {
  storage_key: string;
  driver: string;
  content_type: string;
}

/**
 * Makes the PNG `mail_logo` copy of a logo uploaded before uploads made one, from the stored
 * picture, the first time a mail needs it. Concurrent calls share one run, the unique variant
 * index keeps a second process from adding another, and a failure is logged once per logo: the
 * mail then shows the stored logo.
 */
export async function ensureMailLogo(ctx: Ctx, logoFileId: number | null): Promise<void> {
  const config = configs.get(ctx);
  if (logoFileId === null || !config || failed.has(logoFileId)) return;
  const has = prepared(ctx, "mailLogo.has", () =>
    ctx.sqlite.prepare<{ id: number }, [number]>(
      "SELECT id FROM files WHERE parent_file_id = ?1 AND variant = 'mail_logo'",
    ),
  );
  if (has.get(logoFileId)) return;
  let run = running.get(logoFileId);
  if (!run) {
    run = makeCopy(ctx, config, logoFileId)
      .catch((error) => {
        failed.add(logoFileId);
        console.error("[email.logoCopy]", { logoFileId }, error);
      })
      .finally(() => running.delete(logoFileId));
    running.set(logoFileId, run);
  }
  await run;
}

async function makeCopy(ctx: Ctx, config: StorageConfig, logoFileId: number): Promise<void> {
  const { driver, tempDir } = config;
  const source = prepared(ctx, "mailLogo.source", () =>
    ctx.sqlite.prepare<Source, [number]>(
      "SELECT storage_key, driver, content_type FROM files WHERE id = ?1 AND purpose = 'site_logo' AND parent_file_id IS NULL AND deleted_at IS NULL",
    ),
  ).get(logoFileId);
  if (!source || source.driver !== driver.name) return;
  await mkdir(tempDir, { recursive: true });
  const original = join(tempDir, `sermo-${randomUUID()}`);
  const paths = [original];
  let key: string | null = null;
  try {
    await pipeline(
      Readable.fromWeb(driver.read(source.storage_key).stream() as never),
      createWriteStream(original, { flags: "wx" }),
    );
    const made = await processImage(original, source.content_type, "site_logo", tempDir);
    paths.push(...made.map((item) => item.path));
    const copy = made.find((item) => item.variant === "mail_logo");
    if (!copy) throw new Error("No mail copy was made.");
    key = randomUUID();
    await driver.put(key, copy.path, copy.contentType);
    const stored = key;
    const sha256 = await fileHash(copy.path);
    const written = writeTx(
      ctx,
      () =>
        ctx.sqlite
          .prepare(
            "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, width, height, uploader_id, purpose, visibility, attached_at, parent_file_id, variant, created_at) SELECT driver, ?1, ?2, ?3, ?4, ?5, ?6, uploader_id, purpose, visibility, attached_at, id, 'mail_logo', ?7 FROM files WHERE id = ?8 AND deleted_at IS NULL ON CONFLICT DO NOTHING",
          )
          .run(
            stored,
            copy.byteSize,
            copy.contentType,
            sha256,
            copy.width,
            copy.height,
            ctx.now(),
            logoFileId,
          ).changes === 1,
    );
    if (written) key = null;
  } finally {
    // Stored and not in a row: the logo went meanwhile, or another run made its copy first.
    if (key) await driver.delete(key).catch(() => {});
    for (const path of paths) await rm(path, { force: true, maxRetries: 5, retryDelay: 50 });
  }
}
