import type { Ctx } from "../../context";
import { NotFoundError } from "../../errors";
import { enqueueJob } from "../jobs/queue";

/**
 * Takes an unattached main file the user uploaded with `purpose` and makes it public together
 * with its variants. NotFoundError when it is anything else. Call inside a write transaction.
 */
export function attachUploadedFile(ctx: Ctx, userId: number, fileId: number, purpose: string) {
  const file = ctx.sqlite
    .prepare<{ id: number }, [number, number, string]>(
      "SELECT id FROM files WHERE id = ?1 AND uploader_id = ?2 AND purpose = ?3 AND visibility = 'unattached' AND parent_file_id IS NULL AND deleted_at IS NULL",
    )
    .get(fileId, userId, purpose);
  if (!file) throw new NotFoundError();
  ctx.sqlite
    .prepare(
      "UPDATE files SET visibility = 'public', attached_at = ?1 WHERE id = ?2 OR parent_file_id = ?2",
    )
    .run(ctx.now(), fileId);
}

/** Queues the permanent deletion of a file nothing refers to any more. */
export function releaseFile(ctx: Ctx, fileId: number) {
  enqueueJob(
    ctx,
    "storage.deletePermanent",
    { id: fileId },
    { uniqueKey: `storage.deletePermanent.${fileId}` },
  );
}
