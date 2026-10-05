import type { Actor } from "../../actor";
import { requireAuthenticated } from "../../actor";
import type { Ctx } from "../../context";
import {
  imagesSetAvatar,
  imagesSetCover,
  imagesSetNodeCover,
  imagesSetNodeIcon,
} from "../../contracts/images";
import { writeTx } from "../../db/tx";
import { NotFoundError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { enqueueJob } from "../jobs/queue";
import { requireAdmin } from "../permissions";
import { fileUrl } from "../storage/url";

export type { ImagePurpose, ProcessedImage } from "./process";
export { processImage } from "./process";

type ImageSlot = "avatar" | "cover" | "node_icon" | "node_cover";

function setImage(ctx: Ctx, actor: Actor, fileId: number, slot: ImageSlot, nodeId?: number) {
  const user = requireAuthenticated(actor);
  if (nodeId !== undefined) requireAdmin(ctx, actor);
  return writeTx(ctx, () => {
    const file = ctx.sqlite
      .prepare<{ id: number }, [number, number, string]>(
        "SELECT id FROM files WHERE id = ?1 AND uploader_id = ?2 AND purpose = ?3 AND visibility = 'unattached' AND parent_file_id IS NULL AND deleted_at IS NULL",
      )
      .get(fileId, user.userId, slot);
    if (!file) throw new NotFoundError();
    let previous: number | null;
    if (nodeId === undefined) {
      const column = slot === "avatar" ? "avatar_file_id" : "cover_file_id";
      const row = ctx.sqlite
        .prepare<{ previous: number | null }, [number]>(
          `SELECT ${column} AS previous FROM users WHERE id = ?1`,
        )
        .get(user.userId);
      if (!row) throw new NotFoundError();
      previous = row.previous;
      ctx.sqlite.prepare(`UPDATE users SET ${column} = ?1 WHERE id = ?2`).run(fileId, user.userId);
    } else {
      const column = slot === "node_icon" ? "icon_file_id" : "cover_file_id";
      const row = ctx.sqlite
        .prepare<{ previous: number | null }, [number]>(
          `SELECT ${column} AS previous FROM nodes WHERE id = ?1`,
        )
        .get(nodeId);
      if (!row) throw new NotFoundError();
      previous = row.previous;
      ctx.sqlite.prepare(`UPDATE nodes SET ${column} = ?1 WHERE id = ?2`).run(fileId, nodeId);
    }
    ctx.sqlite
      .prepare(
        "UPDATE files SET visibility = 'public', attached_at = ?1 WHERE id = ?2 OR parent_file_id = ?2",
      )
      .run(ctx.now(), fileId);
    if (previous !== null)
      enqueueJob(
        ctx,
        "storage.deletePermanent",
        { id: previous },
        { uniqueKey: `storage.deletePermanent.${previous}` },
      );
    publishEvent(ctx, {
      type: "content.edited",
      targetType: nodeId === undefined ? "profile" : "node",
      targetId: nodeId ?? user.userId,
    });
    return { fileId, url: fileUrl(fileId) };
  });
}

export const operations = [
  implement(imagesSetAvatar, (ctx, actor, input) => setImage(ctx, actor, input.fileId, "avatar")),
  implement(imagesSetCover, (ctx, actor, input) => setImage(ctx, actor, input.fileId, "cover")),
  implement(imagesSetNodeIcon, (ctx, actor, input) =>
    setImage(ctx, actor, input.fileId, "node_icon", input.nodeId),
  ),
  implement(imagesSetNodeCover, (ctx, actor, input) =>
    setImage(ctx, actor, input.fileId, "node_cover", input.nodeId),
  ),
];
