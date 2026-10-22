import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileTypeFromFile } from "file-type";
import sharp from "sharp";
import type { Actor } from "../../actor";
import { actorUserId, requireAuthenticated } from "../../actor";
import { approvalPending } from "../../approval";
import { type Ctx, prepared } from "../../context";
import { filesGet } from "../../contracts/storage";
import {
  CATALOG_FILE_PURPOSES,
  type FILE_PURPOSES,
  type UPLOAD_SETTING_PURPOSES,
} from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors";
import { consumeEvents } from "../../events";
import { implement } from "../../operation";
import { can, currentActor, permissionValue, requirePermission } from "../../permissions";
import { iso } from "../../time";
import { setAttachments } from "../attachments";
import { reactableConversationMessage } from "../conversations";
import { reactablePost } from "../forums";
import { measureFrameOpening } from "../images/frame-geometry";
import { processImage } from "../images/process";
import { enqueueJob, registerJobHandler } from "../jobs/queue";
import { pollPicturesReadable } from "../polls/readable";
import {
  requireComment as requireProfileComment,
  requirePost as requireProfilePost,
} from "../profiles/shared";
import { cleanFilename, contentDisposition, renamedFor } from "./filename";
import { uploadRefusal } from "./refusal";
import { fileUrl, resolvedFileUrl } from "./url";

export { fileUrl } from "./url";

export interface StorageDriver {
  readonly name: string;
  put(key: string, path: string, type: string): Promise<void>;
  read(key: string): Blob;
  exists?(key: string): Promise<boolean>;
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
    exists(key) {
      return Bun.file(pathFor(key)).exists();
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
    exists(key) {
      return client.exists(key);
    },
    async delete(key) {
      await client.delete(key);
    },
  };
}

type Purpose = (typeof FILE_PURPOSES)[number];
type UploadSettingPurpose = (typeof UPLOAD_SETTING_PURPOSES)[number];
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
  filename: string | null;
  uploader_id: number;
  purpose: Purpose;
  visibility: Visibility;
  created_at: number;
  attached_at: number | null;
  deleted_at: number | null;
  parent_file_id: number | null;
  variant: string | null;
}
export const storageSql = {
  byId: "SELECT * FROM files WHERE id = ?1 AND deleted_at IS NULL",
  stale:
    "SELECT id FROM files WHERE visibility = 'unattached' AND parent_file_id IS NULL AND created_at < ?1 AND deleted_at IS NULL ORDER BY created_at, id LIMIT ?2",
  stalePage:
    "SELECT id, created_at FROM files WHERE visibility = 'unattached' AND parent_file_id IS NULL AND created_at < ?1 AND deleted_at IS NULL AND (created_at > ?2 OR (created_at = ?2 AND id > ?3)) ORDER BY created_at, id LIMIT 1000",
  attachment:
    "SELECT a.content_type, a.content_id, t.node_id FROM attachments a LEFT JOIN posts p ON a.content_type = 'post' AND p.id = a.content_id LEFT JOIN polls pl ON a.content_type = 'poll' AND pl.id = a.content_id LEFT JOIN threads t ON t.id = coalesce(p.thread_id, pl.thread_id) WHERE a.file_id = ?1",
} as const;

const safeInline = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
/** Video and audio a browser plays in its own player: stored as uploaded and served inline. */
const playable = new Set([
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/mp4",
  "audio/ogg",
  "audio/wav",
]);
/** Other names browsers and the content sniffer give the playable types. */
const playableAliases = new Map([
  ["video/x-m4v", "video/mp4"],
  ["audio/x-m4a", "audio/mp4"],
  ["audio/m4a", "audio/mp4"],
  ["audio/mp3", "audio/mpeg"],
  ["audio/ogg; codecs=opus", "audio/ogg"],
  ["audio/opus", "audio/ogg"],
  ["audio/x-wav", "audio/wav"],
  ["audio/wave", "audio/wav"],
  ["audio/vnd.wave", "audio/wav"],
]);
/** The one name a content type is stored and checked under. */
const typeName = (type: string) => playableAliases.get(type.toLowerCase()) ?? type;
const knownText = new Set(["text/plain", "text/csv"]);
const allowedTypes = new Set([
  ...safeInline,
  ...playable,
  ...knownText,
  "application/pdf",
  "application/zip",
  "application/octet-stream",
]);
/**
 * HEIC/HEIF photos (the "high efficiency" setting of many phones). The image library's prebuilt
 * build reads AVIF but not HEVC, which these photos are: they are refused with what to do instead.
 */
const heifTypes = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);
const heifRefusal = () =>
  uploadRefusal("heic", "HEIC and HEIF photos are not supported: send the photo as JPEG.");
/**
 * What a file picker sends for a file whose type it does not know: `application/octet-stream`, or
 * no type at all (`text/plain`, the multipart default). The bytes decide what such a file is.
 */
/** How much of a body that is refused by its declared type is kept on the disk. */
const REFUSED_PREFIX_BYTES = 64 * 1024;

/** A file that takes the first `limit` bytes it is given and drops the rest. */
function prefixWriter(path: string, limit: number) {
  const file = createWriteStream(path, { flags: "wx" });
  let taken = 0;
  return new Writable({
    write(chunk: Buffer, _encoding, callback) {
      const part = chunk.subarray(0, Math.max(0, limit - taken));
      taken += part.byteLength;
      if (part.byteLength === 0) return callback();
      file.write(part, callback);
    },
    final(callback) {
      file.end(callback);
    },
    destroy(error, callback) {
      file.destroy();
      callback(error);
    },
  });
}

const unnamedTypes = new Set(["", "application/octet-stream", "text/plain"]);
const maxBytesDefault = 25 * 1024 * 1024;
/** Catalog and site pictures take these types whatever the site settings say for members. */
const catalogTypes: readonly string[] = ["image/jpeg", "image/png", "image/webp"];
/** Reaction pictures need transparency, so jpeg is left out for them. */
const typesOfCatalogPurpose = (purpose: Purpose): readonly string[] =>
  purpose === "reaction_image" ? ["image/png", "image/webp"] : catalogTypes;
const isCatalogPurpose = (purpose: Purpose): purpose is (typeof CATALOG_FILE_PURPOSES)[number] =>
  (CATALOG_FILE_PURPOSES as readonly string[]).includes(purpose);
/**
 * The size limit of an upload: catalog and site pictures keep the default whatever the site
 * allows members; every other purpose uses `memberLimit` (the site setting).
 */
export function uploadLimit(purpose: Purpose, memberLimit: number = maxBytesDefault): number {
  return isCatalogPurpose(purpose) ? maxBytesDefault : memberLimit;
}
/** Which administrator permission each catalog purpose needs, checked when the file arrives. */
function requireCatalogUpload(ctx: Ctx, actor: Actor, purpose: Purpose): void {
  if (purpose === "frame" || purpose === "cover_preset" || purpose === "thread_cover")
    requirePermission(ctx, actor, "admin.appearance");
  else if (purpose === "award_image") requirePermission(ctx, actor, "admin.awards");
  else if (purpose === "shop_image") requirePermission(ctx, actor, "admin.shop");
  else if (purpose === "reaction_image") requirePermission(ctx, actor, "admin.reactionTypes");
  else if (isCatalogPurpose(purpose)) requirePermission(ctx, actor, "admin.settings");
}
/** The catalog purposes as an SQL list: these files are left out of the attachment.storageQuota sum. */
const quotaPurposes = CATALOG_FILE_PURPOSES.map((purpose) => `'${purpose}'`).join(", ");
/**
 * Whether a stored file counts toward `attachment.storageQuota`: what a member uploaded and its
 * thumbnail do (as they always have), the width copies made from it for smaller screens do not.
 * The member did not choose them and cannot remove them apart, and the backfill that makes them
 * for older pictures must not put anyone over their quota.
 */
const countsTowardQuota = (variant: string | null) =>
  variant === null || !variant.startsWith("width_");

/**
 * The one byte range a `Range` header asks of a file of `size` bytes (`end` included), or null to
 * send the whole file: no header, another unit, several ranges or a malformed one (RFC 9110 lets
 * a server ignore those). A range that starts past the end cannot be sent.
 */
function byteRange(
  header: string | null | undefined,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  const match = /^bytes=(\d{0,15})-(\d{0,15})$/.exec(header?.trim() ?? "");
  if (!match || (match[1] === "" && match[2] === "")) return null;
  const last = size - 1;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    return suffix === 0 || size === 0
      ? "unsatisfiable"
      : { start: Math.max(0, size - suffix), end: last };
  }
  const start = Number(match[1]);
  const end = match[2] === "" ? last : Number(match[2]);
  if (match[2] !== "" && end < start) return null;
  return start > last ? "unsatisfiable" : { start, end: Math.min(end, last) };
}

/**
 * Whether anyone may read the file, whoever asks: avatars, covers and catalog pictures with their
 * variants. Attachments are not, even public ones: who may see a post decides who sees its files.
 */
function isPublicFile(row: FileRecord): boolean {
  return row.visibility === "public" && row.purpose !== "attachment";
}

/**
 * A public file is the same for everyone and never changes at its address: any cache keeps it a
 * year. Any other file is the viewer's and is kept by no cache, the browser's included, so a
 * deleted file or a lost permission hides it at once and nothing of it stays on a shared computer.
 * A variant is decided by its source, the row access is checked on (`source` null: none).
 */
function fileCacheControl(source: FileRecord | null): string {
  return source && isPublicFile(source)
    ? "public, max-age=31536000, immutable"
    : "private, no-store";
}

/**
 * Whether the client's copy is current (RFC 9110 section 13.2.2): `If-None-Match` decides when it
 * is sent (weak comparison, `*` for any copy), else `If-Modified-Since` against `modifiedAt`
 * (epoch ms; HTTP dates hold whole seconds).
 */
function notModified(request: Headers, etag: string, modifiedAt: number): boolean {
  const ifNoneMatch = request.get("if-none-match");
  if (ifNoneMatch !== null)
    return ifNoneMatch
      .split(",")
      .map((tag) => tag.trim().replace(/^W\//, ""))
      .some((tag) => tag === "*" || tag === etag);
  const since = Date.parse(request.get("if-modified-since") ?? "");
  return !Number.isNaN(since) && Math.floor(modifiedAt / 1000) * 1000 <= since;
}

export async function fileHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export function registerStorageJobs(ctx: Ctx, config: StorageConfig): void {
  const storage = createStorage(ctx, config);
  registerJobHandler(ctx, "storage.delete", async (_ctx, payload) => {
    const id = (payload as { id?: unknown })?.id;
    if (!Number.isSafeInteger(id) || Number(id) < 1)
      throw new ValidationError("Invalid file deletion job.");
    await storage.deleteQueued(Number(id), true);
  });
  registerJobHandler(ctx, "storage.deletePermanent", async (_ctx, payload) => {
    const id = (payload as { id?: unknown })?.id;
    if (!Number.isSafeInteger(id) || Number(id) < 1)
      throw new ValidationError("Invalid permanent file deletion job.");
    await storage.deleteQueued(Number(id));
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
  registerJobHandler(ctx, "storage.events", async () => {
    const count = await consumeEvents(
      ctx,
      "storage.files",
      (event) => {
        const payload = event.payload;
        const candidates = payload.permanent === true ? payload.fileIds : payload.removedFileIds;
        if (!Array.isArray(candidates)) return;
        for (const id of candidates) {
          if (!Number.isSafeInteger(id) || Number(id) < 1) continue;
          const file = prepared(ctx, "storage.eventFile", () =>
            ctx.sqlite.prepare<{ deleted_at: number | null }, [number]>(
              "SELECT deleted_at FROM files WHERE id=?1",
            ),
          ).get(Number(id));
          if (!file || (file.deleted_at !== null && file.deleted_at !== -1)) continue;
          enqueueJob(
            ctx,
            "storage.deletePermanent",
            { id },
            { uniqueKey: `storage.deletePermanent.${id}` },
          );
        }
      },
      1000,
    );
    if (count === 1000)
      enqueueJob(ctx, "storage.events", {}, { uniqueKey: `storage.events.next.${ctx.now()}` });
  });
}

export function queueStorageEvents(ctx: Ctx): number | null {
  return enqueueJob(ctx, "storage.events", {}, { uniqueKey: "storage.events" });
}

export interface StorageConfig {
  driver: StorageDriver;
  tempDir: string;
  maxBytes?: number;
  allowedTypesByPurpose?: Partial<Record<UploadSettingPurpose, readonly string[]>>;
}

function byId(ctx: Ctx, id: number) {
  return prepared(ctx, "storage.byId", () =>
    ctx.sqlite.prepare<FileRecord, [number]>(storageSql.byId),
  ).get(id);
}

function attachment(ctx: Ctx, id: number) {
  return prepared(ctx, "storage.attachment", () =>
    ctx.sqlite.prepare<
      { content_type: string; content_id: number; node_id: number | null },
      [number]
    >(storageSql.attachment),
  ).get(id);
}

function canRead(ctx: Ctx, actor: Actor, record: FileRecord): boolean {
  if (record.parent_file_id !== null) {
    const parent = byId(ctx, record.parent_file_id);
    return parent !== null && canRead(ctx, actor, parent);
  }
  const link = attachment(ctx, record.id);
  if (!link) {
    if (record.visibility === "unattached") return actorUserId(actor) === record.uploader_id;
    return record.visibility === "public";
  }
  // Files of posts and wall posts are the site's content: closed to anyone who may not open the
  // site. Conversation files are not (a closed-out member keeps their inbox), and avatars and
  // covers (public files with no link) stay as they are.
  if (link.content_type !== "conversation_message" && !can(ctx, actor, "site.view")) return false;
  try {
    if (link.content_type === "post") {
      reactablePost(ctx, actor, link.content_id);
      if (
        link.node_id === null ||
        !can(ctx, actor, "forum.viewAttachments", { nodeId: link.node_id })
      )
        return false;
    } else if (link.content_type === "poll") {
      // The pictures of a poll are the thread's content: the thread must be open and its text readable.
      if (
        link.node_id === null ||
        !pollPicturesReadable(ctx, actor, link.content_id) ||
        !can(ctx, actor, "forum.viewAttachments", { nodeId: link.node_id })
      )
        return false;
    } else if (link.content_type === "profile_post")
      requireProfilePost(ctx, actor, link.content_id);
    else if (link.content_type === "profile_post_comment")
      requireProfileComment(ctx, actor, link.content_id);
    else if (link.content_type === "conversation_message") {
      const message = reactableConversationMessage(ctx, actor, link.content_id);
      if (
        !message.isVisible &&
        message.authorId !== actorUserId(actor) &&
        !can(ctx, actor, "conversation.viewHidden")
      )
        return false;
    } else return false;
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
    const variants = prepared(ctx, "storage.variants", () =>
      ctx.sqlite.prepare<{ id: number; variant: string; width: number; height: number }, [number]>(
        "SELECT id, variant, width, height FROM files WHERE parent_file_id = ?1 AND deleted_at IS NULL ORDER BY variant",
      ),
    ).all(row.id);
    return {
      id: row.id,
      url: resolvedFileUrl(ctx, row.id, isPublicFile(row)),
      byteSize: row.byte_size,
      contentType: row.content_type,
      filename: row.filename,
      width: row.width,
      height: row.height,
      purpose: row.purpose,
      visibility: row.visibility,
      createdAt: iso(row.created_at),
      variants: variants.map((variant) => ({
        variant: variant.variant,
        fileId: variant.id,
        url: resolvedFileUrl(ctx, variant.id, isPublicFile(row)),
        width: variant.width,
        height: variant.height,
      })),
    };
  }),
];

async function measureOpening(path: string) {
  const { data, info } = await sharp(await readFile(path))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return measureFrameOpening(data, info.width, info.height);
}

export function createStorage(ctx: Ctx, config: StorageConfig) {
  const { driver, tempDir } = config;
  const maxBytes = config.maxBytes ?? maxBytesDefault;
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new ValidationError("Invalid upload limit.");

  return {
    async upload(
      actor: Actor,
      source: ReadableStream<Uint8Array>,
      clientType: string,
      purpose: Purpose = "attachment",
      /** The name the client gave the file; kept (cleaned) for attachments only and used to download them. */
      originalName?: string | null,
    ) {
      const filename = purpose === "attachment" ? cleanFilename(originalName) : null;
      const user = requireAuthenticated(actor);
      // The upload route does not go through `execute`: an account that waits for approval is refused here.
      if (user.principal?.awaitingApproval) throw approvalPending();
      const catalog = isCatalogPurpose(purpose);
      if (catalog) requireCatalogUpload(ctx, actor, purpose);
      if (purpose === "avatar") requirePermission(ctx, actor, "profile.uploadAvatar");
      if (purpose === "cover") requirePermission(ctx, actor, "profile.uploadCover");
      const clientDeclared = typeName(clientType);
      // The type the file is checked and stored as: the client's, or for an unnamed type what its
      // bytes are (set once they are read).
      let declaredType = clientDeclared;
      // The member's own largest file (-1: none; 0: no file at all) can only lower the site's limit.
      const memberLimit = catalog ? -1 : permissionValue(ctx, actor, "attachment.maxFileSize");
      const siteLimit = uploadLimit(purpose, maxBytes);
      const groupBinds = memberLimit !== -1 && memberLimit < siteLimit;
      const effectiveLimit = groupBinds ? memberLimit : siteLimit;
      await mkdir(tempDir, { recursive: true });
      const tempPath = join(tempDir, `sermo-${randomUUID()}`);
      const hash = createHash("sha256");
      const typeAllowed = (type: string) =>
        allowedTypes.has(type) &&
        (catalog
          ? typesOfCatalogPurpose(purpose).includes(type)
          : !config.allowedTypesByPurpose ||
            !!config.allowedTypesByPurpose[purpose as UploadSettingPurpose]?.includes(type));
      // A body whose declared type is refused whatever its bytes are is still read to its end, so
      // the refusal arrives as words, but only a prefix (enough to sniff a HEIC) reaches the disk.
      const refusedAtOnce =
        !unnamedTypes.has(declaredType) &&
        (heifTypes.has(declaredType) || !typeAllowed(declaredType));
      let size = 0;
      let processed: {
        path: string;
        contentType: string;
        width: number | null;
        height: number | null;
        byteSize: number;
        variant: string | null;
      }[] = [];
      try {
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            size += chunk.byteLength;
            if (size > effectiveLimit)
              return callback(
                uploadRefusal(
                  "size",
                  groupBinds
                    ? `File exceeds your upload limit of ${effectiveLimit} bytes.`
                    : "File exceeds upload limit.",
                  effectiveLimit,
                ),
              );
            hash.update(chunk);
            callback(null, chunk);
          },
        });
        await pipeline(
          Readable.fromWeb(source as never),
          meter,
          refusedAtOnce
            ? prefixWriter(tempPath, REFUSED_PREFIX_BYTES)
            : createWriteStream(tempPath, { flags: "wx" }),
        );
        if (size === 0) throw uploadRefusal("empty", "File is empty.");
        const detected = await fileTypeFromFile(tempPath);
        if (heifTypes.has(declaredType) || (detected && heifTypes.has(detected.mime)))
          throw heifRefusal();
        if (unnamedTypes.has(declaredType) && detected) declaredType = typeName(detected.mime);
        // Checked once the file is read to its end: a refusal answered while a large body still
        // streams in reaches the browser as a broken connection, not as words.
        if (!typeAllowed(declaredType)) throw uploadRefusal("type", "File type is not allowed.");
        if (detected && typeName(detected.mime) !== declaredType)
          throw uploadRefusal("unreadable", "File type does not match its content.");
        if (!detected && !knownText.has(declaredType))
          throw uploadRefusal("unreadable", "File type could not be verified.");
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
                throw uploadRefusal("unreadable", "Scriptable content is not allowed.");
              tail = decoded.slice(-32);
            }
            decoder.decode();
          } catch {
            throw uploadRefusal("unreadable", "File type could not be verified.");
          }
        }
        processed = safeInline.has(declaredType)
          ? await processImage(tempPath, declaredType, purpose, tempDir)
          : [
              {
                path: tempPath,
                contentType: declaredType,
                width: null,
                height: null,
                byteSize: size,
                variant: null,
              },
            ];
        // Measured here, from the stored pixels, so that no write transaction waits for it.
        const meta =
          purpose === "frame"
            ? JSON.stringify({ opening: await measureOpening(processed[0]!.path) })
            : null;
        const artifacts = await Promise.all(
          processed.map(async (item) => ({
            ...item,
            storageKey: randomUUID(),
            sha256: item.path === tempPath ? hash.digest("hex") : await fileHash(item.path),
          })),
        );
        const stored: string[] = [];
        try {
          for (const item of artifacts) {
            try {
              await driver.put(item.storageKey, item.path, item.contentType);
            } catch (error) {
              await driver.delete(item.storageKey).catch(() => {});
              throw error;
            }
            stored.push(item.storageKey);
          }
          const row = writeTx(ctx, () => {
            // The file was read and stored while the request ran: what the member may upload is
            // decided again from their standing now.
            const current = currentActor(ctx, actor);
            if (catalog) requireCatalogUpload(ctx, current, purpose);
            if (purpose === "avatar") requirePermission(ctx, current, "profile.uploadAvatar");
            if (purpose === "cover") requirePermission(ctx, current, "profile.uploadCover");
            const quota = catalog ? -1 : permissionValue(ctx, current, "attachment.storageQuota");
            if (quota !== -1) {
              const used = ctx.sqlite
                .prepare<{ bytes: number }, [number]>(
                  `SELECT COALESCE(SUM(byte_size), 0) AS bytes FROM files WHERE uploader_id = ?1 AND deleted_at IS NULL AND purpose NOT IN (${quotaPurposes}) AND (variant IS NULL OR variant NOT GLOB 'width_*')`,
                )
                .get(user.userId)!.bytes;
              const adding = artifacts
                .filter((item) => countsTowardQuota(item.variant))
                .reduce((total, item) => total + item.byteSize, 0);
              if (used + adding > quota) throw uploadRefusal("quota", "Upload quota exceeded.");
            }
            const main = artifacts[0]!;
            const created = ctx.sqlite
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
                  string | null,
                  string | null,
                ]
              >(
                "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, width, height, uploader_id, purpose, visibility, created_at, meta, filename) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'unattached', ?10, ?11, ?12) RETURNING id",
              )
              .get(
                driver.name,
                main.storageKey,
                main.byteSize,
                main.contentType,
                main.sha256,
                main.width,
                main.height,
                user.userId,
                purpose,
                ctx.now(),
                meta,
                filename && main.contentType !== clientDeclared
                  ? renamedFor(filename, main.contentType)
                  : filename,
              )!;
            for (const variant of artifacts.slice(1))
              ctx.sqlite
                .prepare(
                  "INSERT INTO files (driver, storage_key, byte_size, content_type, sha256, width, height, uploader_id, purpose, visibility, parent_file_id, variant, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'unattached', ?10, ?11, ?12)",
                )
                .run(
                  driver.name,
                  variant.storageKey,
                  variant.byteSize,
                  variant.contentType,
                  variant.sha256,
                  variant.width,
                  variant.height,
                  user.userId,
                  purpose,
                  created.id,
                  variant.variant,
                  ctx.now(),
                );
            return created;
          });
          return {
            id: row.id,
            url: fileUrl(row.id),
            byteSize: artifacts[0]!.byteSize,
            contentType: artifacts[0]!.contentType,
          };
        } catch (error) {
          await Promise.all(stored.map((key) => driver.delete(key).catch(() => {})));
          throw error;
        }
      } finally {
        await Promise.all(
          processed
            .filter((item) => item.path !== tempPath)
            .map((item) => rm(item.path, { force: true, maxRetries: 5, retryDelay: 50 })),
        );
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
        if (
          row?.visibility !== "unattached" ||
          row.uploader_id !== user.userId ||
          row.parent_file_id !== null
        )
          throw new NotFoundError();
        let contentOwner: number;
        if (contentType === "post") contentOwner = reactablePost(ctx, actor, contentId).authorId;
        else if (contentType === "profile_post")
          contentOwner = requireProfilePost(ctx, actor, contentId).user_id;
        else contentOwner = reactableConversationMessage(ctx, actor, contentId).authorId;
        if (contentOwner !== user.userId) throw new ForbiddenError();
        const visibility = contentType === "conversation_message" ? "private" : "public";
        const old = ctx.sqlite
          .prepare<{ file_id: number }, [string, number]>(
            "SELECT file_id FROM attachments WHERE content_type = ?1 AND content_id = ?2 ORDER BY position",
          )
          .all(contentType, contentId)
          .map((link) => link.file_id);
        setAttachments(ctx, user.userId, contentType, contentId, [...old, fileId]);
        return { id: fileId, url: fileUrl(fileId), visibility };
      });
    },
    /**
     * `request` holds the request's headers: `Range` (players ask for parts of a file to seek),
     * `If-None-Match` and `If-Modified-Since` (a cached copy is checked, answered 304).
     */
    serve(actor: Actor, id: number, request: Headers = new Headers()) {
      const row = getFileRecord(ctx, actor, id);
      if (row.driver !== driver.name) throw new ValidationError("Storage driver is unavailable.");
      const range = request.get("range");
      // Players and their metadata probes always send a range: only a whole-file read (a link
      // opened or saved, a picture shown) is a download, answered 304 or not.
      if (row.purpose === "attachment" && row.parent_file_id === null && !range)
        ctx.downloads.set(id, (ctx.downloads.get(id) ?? 0) + 1);
      // The bytes of a file id never change (a replaced picture is a new upload, a new id), so its
      // hash is a strong validator and its upload time the last modification.
      const validators = {
        ETag: `"${row.sha256}"`,
        "Last-Modified": new Date(row.created_at).toUTCString(),
        "Cache-Control": fileCacheControl(
          row.parent_file_id === null ? row : byId(ctx, row.parent_file_id),
        ),
      };
      if (notModified(request, validators.ETag, row.created_at))
        return new Response(null, { status: 304, headers: validators });
      const part = byteRange(range, row.byte_size);
      if (part === "unsatisfiable")
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${row.byte_size}`,
            "Accept-Ranges": "bytes",
            // Never kept: a cache that stored it would answer the whole file with it.
            "Cache-Control": "private, no-store",
          },
        });
      const blob = driver.read(row.storage_key);
      const inline = safeInline.has(row.content_type) || playable.has(row.content_type);
      return new Response(part ? blob.slice(part.start, part.end + 1) : blob, {
        status: part ? 206 : 200,
        headers: {
          "Content-Type": inline ? row.content_type : "application/octet-stream",
          "Content-Length": String(part ? part.end - part.start + 1 : row.byte_size),
          ...(part && { "Content-Range": `bytes ${part.start}-${part.end}/${row.byte_size}` }),
          "Accept-Ranges": "bytes",
          "X-Content-Type-Options": "nosniff",
          "Content-Disposition": contentDisposition(
            inline ? "inline" : "attachment",
            row.filename,
            `file-${row.id}`,
          ),
          ...validators,
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
      if (row.parent_file_id === null) {
        const variants = ctx.sqlite
          .prepare<{ id: number }, [number]>("SELECT id FROM files WHERE parent_file_id = ?1")
          .all(id);
        for (const variant of variants) await this.deleteQueued(variant.id, onlyUnattached);
      }
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
