import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileTypeFromFile } from "file-type";
import type { Actor } from "../../actor";
import { actorUserId, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { filesGet } from "../../contracts/storage";
import { writeTx } from "../../db/tx";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { iso } from "../../time";
import { reactableConversationMessage } from "../conversations";
import { reactablePost } from "../forums";
import { enqueueJob, registerJobHandler } from "../jobs/queue";
import { requirePost as requireProfilePost } from "../profiles/shared";

export interface StorageDriver {
  readonly name: string;
  put(key: string, path: string, type: string): Promise<void>;
  read(key: string): Blob;
  delete(key: string): Promise<void>;
}

export function localDriver(root: string): StorageDriver {
  const base = resolve(root);
  const pathFor = (key: string) => {
    if (!/^[a-f0-9-]{36}$/.test(key)) throw new ValidationError("Invalid storage key.");
    const path = resolve(base, key);
    if (!path.startsWith(`${base}${sep}`)) throw new ValidationError("Invalid storage key.");
    return path;
  };
  return {
    name: "local",
    async put(key, path) {
      await mkdir(base, { recursive: true });
      // The upload was spooled in the same filesystem only when its temp root matches.
      await pipeline(createReadStream(path), createWriteStream(pathFor(key), { flags: "wx" }));
    },
    read(key) {
      return Bun.file(pathFor(key));
    },
    async delete(key) {
      await rm(pathFor(key), { force: true });
    },
  };
}

export function s3Driver(options: ConstructorParameters<typeof Bun.S3Client>[0]): StorageDriver {
  const client = new Bun.S3Client(options);
  return {
    name: "s3",
    async put(key, path, type) {
      await client.write(key, Bun.file(path), { type });
    },
    read(key) {
      return client.file(key);
    },
    async delete(key) {
      await client.delete(key);
    },
  };
}

type Purpose = "attachment" | "avatar" | "cover" | "node_icon" | "node_cover";
type Visibility = "unattached" | "public" | "private";
type AttachmentContentType = "post" | "profile_post" | "conversation_message";
export interface FileRecord {
  id: number;
  driver: string;
  storage_key: string;
  byte_size: number;
  content_type: string;
  sha256: string;
  width: number | null;
  height: number | null;
  uploader_id: number;
  purpose: Purpose;
  visibility: Visibility;
  created_at: number;
  attached_at: number | null;
  deleted_at: number | null;
}
export const storageSql = {
  byId: "SELECT * FROM files WHERE id = ?1 AND deleted_at IS NULL",
  stale:
    "SELECT id FROM files WHERE visibility = 'unattached' AND created_at < ?1 AND deleted_at IS NULL ORDER BY created_at, id LIMIT ?2",
  stalePage:
    "SELECT id, created_at FROM files WHERE visibility = 'unattached' AND created_at < ?1 AND deleted_at IS NULL AND (created_at > ?2 OR (created_at = ?2 AND id > ?3)) ORDER BY created_at, id LIMIT 1000",
  attachment: "SELECT content_type, content_id FROM attachments WHERE file_id = ?1",
} as const;

const safeInline = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const knownText = new Set(["text/plain", "text/csv"]);
const allowedTypes = new Set([
  ...safeInline,
  ...knownText,
  "application/pdf",
  "application/zip",
  "application/octet-stream",
]);
const maxBytesDefault = 25 * 1024 * 1024;

function imageDimensions(
  bytes: Uint8Array,
  mime: string,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mime === "image/png" && bytes.length >= 24)
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (mime === "image/gif" && bytes.length >= 10)
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  if (mime === "image/jpeg") {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1]!;
      if (marker === 0xd9 || marker === 0xda) break;
      const length = view.getUint16(offset + 2);
      if (length < 2) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      )
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      offset += length + 2;
    }
  }
  return null;
}

export function registerStorageJobs(ctx: Ctx, config: StorageConfig): void {
  const storage = createStorage(ctx, config);
  registerJobHandler(ctx, "storage.delete", async (_ctx, payload) => {
    const id = (payload as { id?: unknown })?.id;
    if (!Number.isSafeInteger(id) || Number(id) < 1)
      throw new ValidationError("Invalid file deletion job.");
    await storage.deleteQueued(Number(id), true);
  });
  registerJobHandler(ctx, "storage.cleanup", () => {
    const cutoff = ctx.now() - 24 * 60 * 60_000;
    const query = prepared(ctx, "storage.stalePage", () =>
      ctx.sqlite.prepare<{ id: number; created_at: number }, [number, number, number]>(
        storageSql.stalePage,
      ),
    );
    let createdAt = -1;
    let afterId = 0;
    for (;;) {
      const rows = query.all(cutoff, createdAt, afterId);
      for (const row of rows)
        enqueueJob(
          ctx,
          "storage.delete",
          { id: row.id },
          { uniqueKey: `storage.delete.${row.id}` },
        );
      if (rows.length < 1000) break;
      createdAt = rows.at(-1)!.created_at;
      afterId = rows.at(-1)!.id;
    }
  });
}

export function fileUrl(id: number): string {
  return `/api/v1/files/${id}`;
}

export interface StorageConfig {
  driver: StorageDriver;
  tempDir: string;
  maxBytes?: number;
  allowedTypesByPurpose?: Partial<Record<Purpose, readonly string[]>>;
  groupUploadLimitBytes?: Record<number, number>;
}

function byId(ctx: Ctx, id: number) {
  return prepared(ctx, "storage.byId", () =>
    ctx.sqlite.prepare<FileRecord, [number]>(storageSql.byId),
  ).get(id);
}

function attachment(ctx: Ctx, id: number) {
  return prepared(ctx, "storage.attachment", () =>
    ctx.sqlite.prepare<{ content_type: string; content_id: number }, [number]>(
      storageSql.attachment,
    ),
  ).get(id);
}

function canRead(ctx: Ctx, actor: Actor, record: FileRecord): boolean {
  const link = attachment(ctx, record.id);
  if (!link) {
    if (record.visibility === "unattached") return actorUserId(actor) === record.uploader_id;
    return record.visibility === "public";
  }
  try {
    if (link.content_type === "post") reactablePost(ctx, actor, link.content_id);
    else if (link.content_type === "profile_post") requireProfilePost(ctx, actor, link.content_id);
    else if (link.content_type === "conversation_message")
      reactableConversationMessage(ctx, actor, link.content_id);
    else return false;
    return true;
  } catch {
    return false;
  }
}

export function getFileRecord(ctx: Ctx, actor: Actor, id: number): FileRecord {
  const row = byId(ctx, id);
  if (!row || !canRead(ctx, actor, row)) throw new NotFoundError();
  return row;
}

export const operations = [
  implement(filesGet, (ctx, actor, input) => {
    const row = getFileRecord(ctx, actor, input.fileId);
    return {
      id: row.id,
      url: fileUrl(row.id),
      byteSize: row.byte_size,
      contentType: row.content_type,
      width: row.width,
      height: row.height,
      purpose: row.purpose,
      visibility: row.visibility,
      createdAt: iso(row.created_at),
    };
  }),
];

export function createStorage(ctx: Ctx, config: StorageConfig) {
  const { driver, tempDir } = config;
  const maxBytes = config.maxBytes ?? maxBytesDefault;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new ValidationError("Invalid upload limit.");

  return {
    async upload(
      actor: Actor,
      source: ReadableStream<Uint8Array>,
      declaredType: string,
      purpose: Purpose = "attachment",
    ) {
      const user = requireAuthenticated(actor);
      if (
        !allowedTypes.has(declaredType) ||
        (config.allowedTypesByPurpose &&
          !config.allowedTypesByPurpose[purpose]?.includes(declaredType))
      )
        throw new ValidationError("File type is not allowed.");
      const effectiveLimit = maxBytes;
      await mkdir(tempDir, { recursive: true });
      const tempPath = join(tempDir, `sermo-${randomUUID()}`);
      const hash = createHash("sha256");
      let size = 0;
      try {
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            size += chunk.byteLength;
            if (size > effectiveLimit)
              return callback(new ValidationError("File exceeds upload limit."));
            hash.update(chunk);
            callback(null, chunk);
          },
        });
        await pipeline(
          Readable.fromWeb(source as never),
          meter,
          createWriteStream(tempPath, { flags: "wx" }),
        );
        if (size === 0) throw new ValidationError("File is empty.");
        const detected = await fileTypeFromFile(tempPath);
        if (detected && detected.mime !== declaredType)
          throw new ValidationError("File type does not match its content.");
        if (!detected && !knownText.has(declaredType))
          throw new ValidationError("File type could not be verified.");
        const handle = await open(tempPath, "r");
        const header = Buffer.alloc(Math.min(size, 65_536));
        try {
          await handle.read(header, 0, header.length, 0);
        } finally {
          await handle.close();
        }
        if (!detected) {
          let tail = "";
          try {
            const decoder = new TextDecoder("utf-8", { fatal: true });
            for await (const chunk of createReadStream(tempPath)) {
              const decoded = tail + decoder.decode(chunk, { stream: true });
              if (
                [...decoded].some((char) => {
                  const code = char.charCodeAt(0);
                  return code < 32 && code !== 9 && code !== 10 && code !== 13;
                }) ||
                /<\s*(?:svg|script|html|iframe)\b/i.test(decoded)
              )
                throw new ValidationError("Scriptable content is not allowed.");
              tail = decoded.slice(-32);
            }
            decoder.decode();
          } catch {
            throw new ValidationError("File type could not be verified.");
          }
        }
        const dimensions = imageDimensions(header, declaredType);
        const key = randomUUID();
        try {
          await driver.put(key, tempPath, declaredType);
        } catch (error) {
          await driver.delete(key).catch(() => {});
          throw error;
        }
        try {
          const row = writeTx(ctx, () => {
            const quota = config.groupUploadLimitBytes?.[user.groupId];
            if (quota != null) {
              const used = ctx.sqlite
                .prepare<{ bytes: number }, [number]>(
                  "SELECT COALESCE(SUM(byte_size), 0) AS bytes FROM files WHERE uploader_id = ?1 AND deleted_at IS NULL",
                )
                .get(user.userId)!.bytes;
              if (used + size > quota) throw new ValidationError("Upload quota exceeded.");
            }
            return ctx.sqlite
              .prepare<
                { id: number },
                [
                  string,
                  string,
                  number,
                  string,
                  string,
                  number | null,
                  number | null,
                  number,
                  Purpose,
                  number,
                ]
              >(
                "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, width, height, uploader_id, purpose, visibility, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'unattached', ?10) RETURNING id",
              )
              .get(
                driver.name,
                key,
                size,
                declaredType,
                hash.digest("hex"),
                dimensions?.width ?? null,
                dimensions?.height ?? null,
                user.userId,
                purpose,
                ctx.now(),
              )!;
          });
          return { id: row.id, url: fileUrl(row.id), byteSize: size, contentType: declaredType };
        } catch (error) {
          await driver.delete(key);
          throw error;
        }
      } finally {
        await rm(tempPath, { force: true });
      }
    },
    get(actor: Actor, id: number) {
      const row = getFileRecord(ctx, actor, id);
      if (row.driver !== driver.name) throw new ValidationError("Storage driver is unavailable.");
      return row;
    },
    attach(actor: Actor, fileId: number, contentType: AttachmentContentType, contentId: number) {
      const user = requireAuthenticated(actor);
      return writeTx(ctx, () => {
        const row = byId(ctx, fileId);
        if (row?.visibility !== "unattached" || row.uploader_id !== user.userId)
          throw new NotFoundError();
        let contentOwner: number;
        if (contentType === "post") contentOwner = reactablePost(ctx, actor, contentId).authorId;
        else if (contentType === "profile_post")
          contentOwner = requireProfilePost(ctx, actor, contentId).user_id;
        else contentOwner = reactableConversationMessage(ctx, actor, contentId).authorId;
        if (contentOwner !== user.userId) throw new ForbiddenError();
        const visibility = contentType === "conversation_message" ? "private" : "public";
        ctx.sqlite
          .prepare(
            "INSERT INTO attachments (file_id, content_type, content_id, created_at) VALUES (?1, ?2, ?3, ?4)",
          )
          .run(fileId, contentType, contentId, ctx.now());
        ctx.sqlite
          .prepare("UPDATE files SET visibility = ?1, attached_at = ?2 WHERE id = ?3")
          .run(visibility, ctx.now(), fileId);
        return { id: fileId, url: fileUrl(fileId), visibility };
      });
    },
    serve(actor: Actor, id: number) {
      const row = getFileRecord(ctx, actor, id);
      if (row.driver !== driver.name) throw new ValidationError("Storage driver is unavailable.");
      const blob = driver.read(row.storage_key);
      const disposition = safeInline.has(row.content_type) ? "inline" : "attachment";
      return new Response(blob, {
        headers: {
          "Content-Type": safeInline.has(row.content_type)
            ? row.content_type
            : "application/octet-stream",
          "Content-Length": String(row.byte_size),
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": `${disposition}; filename="file-${row.id}"`,
          "Cache-Control":
            row.visibility === "public" ? "public, max-age=3600" : "private, no-store",
        },
      });
    },
    async download(actor: Actor, id: number): Promise<Uint8Array> {
      const row = getFileRecord(ctx, actor, id);
      if (row.driver !== driver.name) throw new ValidationError("Storage driver is unavailable.");
      return new Uint8Array(await driver.read(row.storage_key).arrayBuffer());
    },
    /** Call from a durable deletion job. Metadata remains for audit until this succeeds. */
    async deleteQueued(id: number, onlyUnattached = false) {
      const row = writeTx(ctx, () => {
        const current = ctx.sqlite
          .prepare<FileRecord, [number]>("SELECT * FROM files WHERE id = ?1")
          .get(id);
        if (!current || (current.deleted_at !== null && current.deleted_at !== -1)) return null;
        if (onlyUnattached && current.visibility !== "unattached") return null;
        if (current.deleted_at === null) {
          const changed = ctx.sqlite
            .prepare("UPDATE files SET deleted_at = -1 WHERE id = ?1 AND deleted_at IS NULL")
            .run(id);
          if (!changed.changes) return null;
        }
        return current;
      });
      if (!row) return;
      if (row.driver !== driver.name) throw new ValidationError("Storage driver is unavailable.");
      await driver.delete(row.storage_key);
      ctx.sqlite
        .prepare("UPDATE files SET deleted_at = ?1 WHERE id = ?2 AND deleted_at = -1")
        .run(ctx.now(), id);
    },
    /** Returns ids for the caller to enqueue; does not mutate rows during a read. */
    staleUnattached(before: number, limit = 100): number[] {
      return prepared(ctx, "storage.stale", () =>
        ctx.sqlite.prepare<{ id: number }, [number, number]>(storageSql.stale),
      )
        .all(before, limit)
        .map((row) => row.id);
    },
  };
}
