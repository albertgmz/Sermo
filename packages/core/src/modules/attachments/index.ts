import type { Ctx } from "../../context";
import { prepared } from "../../context";
import { NotFoundError, ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { enqueueJob } from "../jobs";
import { fileUrl } from "../storage/url";

export type AttachmentTarget = "post" | "profile_post" | "conversation_message";

interface AttachmentRow {
  content_id: number;
  file_id: number;
  content_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  thumbnail_id: number | null;
}

export const attachmentsPageSql =
  "SELECT a.content_id, f.id AS file_id, f.content_type, f.byte_size, f.width, f.height, thumb.id AS thumbnail_id FROM attachments a JOIN files f ON f.id = a.file_id LEFT JOIN files thumb INDEXED BY files_variant ON thumb.parent_file_id = f.id AND thumb.variant = 'thumbnail' AND thumb.deleted_at IS NULL WHERE a.content_type = ?1 AND a.content_id IN (SELECT value FROM json_each(?2)) ORDER BY a.content_id, a.position";

export function loadAttachments(ctx: Ctx, type: AttachmentTarget, ids: number[]) {
  const result = new Map<
    number,
    {
      fileId: number;
      url: string;
      contentType: string;
      byteSize: number;
      width: number | null;
      height: number | null;
      thumbnailUrl: string | null;
    }[]
  >();
  if (!ids.length) return result;
  const rows = prepared(ctx, "attachments.page", () =>
    ctx.sqlite.prepare<AttachmentRow, [AttachmentTarget, string]>(attachmentsPageSql),
  ).all(type, JSON.stringify(ids));
  for (const row of rows) {
    const group = result.get(row.content_id) ?? [];
    group.push({
      fileId: row.file_id,
      url: fileUrl(row.file_id),
      contentType: row.content_type,
      byteSize: row.byte_size,
      width: row.width,
      height: row.height,
      thumbnailUrl: row.thumbnail_id === null ? null : fileUrl(row.thumbnail_id),
    });
    result.set(row.content_id, group);
  }
  return result;
}

/** Called inside the content write transaction. A supplied list is the complete new list. */
export function setAttachments(
  ctx: Ctx,
  ownerId: number,
  type: AttachmentTarget,
  contentId: number,
  ids: number[] | undefined,
) {
  if (ids === undefined) return;
  if (new Set(ids).size !== ids.length) throw new ValidationError("Duplicate attachment ID.");
  const table =
    type === "post" ? "posts" : type === "profile_post" ? "profile_posts" : "conversation_messages";
  const old = ctx.sqlite
    .prepare<{ file_id: number }, [AttachmentTarget, number]>(
      "SELECT file_id FROM attachments WHERE content_type = ?1 AND content_id = ?2 ORDER BY position",
    )
    .all(type, contentId)
    .map((row) => row.file_id);
  const oldSet = new Set(old);
  const nextSet = new Set(ids);
  const now = ctx.now();
  for (const fileId of ids) {
    if (oldSet.has(fileId)) continue;
    const claim = ctx.sqlite
      .prepare(
        "UPDATE files SET visibility = ?1, attached_at = ?2 WHERE id = ?3 AND uploader_id = ?4 AND purpose = 'attachment' AND visibility = 'unattached' AND parent_file_id IS NULL AND deleted_at IS NULL",
      )
      .run(type === "conversation_message" ? "private" : "public", now, fileId, ownerId);
    if (!claim.changes) throw new NotFoundError();
    ctx.sqlite
      .prepare("UPDATE files SET visibility = ?1, attached_at = ?2 WHERE parent_file_id = ?3")
      .run(type === "conversation_message" ? "private" : "public", now, fileId);
    ctx.sqlite
      .prepare(
        "INSERT INTO attachments (file_id, content_type, content_id, position, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .run(fileId, type, contentId, ids.indexOf(fileId), now);
  }
  for (const fileId of old) {
    if (nextSet.has(fileId)) continue;
    ctx.sqlite.prepare("DELETE FROM attachments WHERE file_id = ?1").run(fileId);
    ctx.sqlite
      .prepare("UPDATE files SET visibility = 'private' WHERE id = ?1 OR parent_file_id = ?1")
      .run(fileId);
    publishEvent(ctx, {
      type: "content.edited",
      targetType: type,
      targetId: contentId,
      payload: { removedFileIds: [fileId] },
    });
    enqueueJob(
      ctx,
      "storage.deletePermanent",
      { id: fileId },
      { uniqueKey: `storage.deletePermanent.${fileId}` },
    );
    enqueueJob(ctx, "storage.events", {}, { uniqueKey: "storage.events" });
  }
  const reorder = ctx.sqlite.prepare("UPDATE attachments SET position = ?1 WHERE file_id = ?2");
  ids.forEach((id, position) => {
    reorder.run(position, id);
  });
  ctx.sqlite
    .prepare(`UPDATE ${table} SET attachment_count = ?1 WHERE id = ?2`)
    .run(ids.length, contentId);
}

/** Prevent a Sermo image embed from pointing at another content item's file. */
export function validateEmbeddedAttachments(
  ctx: Ctx,
  type: AttachmentTarget,
  contentId: number,
  html: string,
) {
  const embedded = [...html.matchAll(/<img\b[^>]*\bsrc="\/api\/v1\/files\/(\d+)"/g)];
  if (!embedded.length) return;
  const attached = new Set(
    ctx.sqlite
      .prepare<{ file_id: number; content_type: string }, [AttachmentTarget, number]>(
        "SELECT a.file_id, f.content_type FROM attachments a JOIN files f ON f.id = a.file_id WHERE a.content_type = ?1 AND a.content_id = ?2 AND f.content_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')",
      )
      .all(type, contentId)
      .map((row) => row.file_id),
  );
  for (const match of embedded) {
    if (!attached.has(Number(match[1])))
      throw new ValidationError("Embedded image must be attached to this content.");
  }
}
