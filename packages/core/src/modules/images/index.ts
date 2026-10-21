import type { Actor } from "../../actor";
import { requireAuthenticated } from "../../actor";
import type { Ctx } from "../../context";
import {
  imagesSetAvatar,
  imagesSetAwardImage,
  imagesSetCover,
  imagesSetNodeCover,
  imagesSetNodeIcon,
  imagesSetShopItemImage,
} from "../../contracts/images";
import { writeTx } from "../../db/tx";
import { NotFoundError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { currentActor, requirePermission } from "../../permissions";
import { appendModeratorLog } from "../moderation";
import { publicPicture } from "../storage/url";
import { attachUploadedFile, releaseFile } from "./attach";

export type { ImagePurpose, ProcessedImage } from "./process";
export { processImage } from "./process";

type ImageSlot = "avatar" | "cover" | "node_icon" | "node_cover";

/** The input is read only after the caller has been checked, so a refused caller never sees a 400. */
function setImage(
  ctx: Ctx,
  actor: Actor,
  input: { fileId: number | null; nodeId?: number },
  slot: ImageSlot,
) {
  const user = requireAuthenticated(actor);
  if (slot === "node_icon" || slot === "node_cover") requirePermission(ctx, actor, "admin.nodes");
  const { fileId, nodeId } = input;
  // Taking a picture off needs no permission.
  if (fileId !== null && slot === "avatar") requirePermission(ctx, actor, "profile.uploadAvatar");
  if (fileId !== null && slot === "cover") requirePermission(ctx, actor, "profile.uploadCover");
  return writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    if (nodeId !== undefined) requirePermission(ctx, current, "admin.nodes");
    if (fileId !== null && slot === "avatar")
      requirePermission(ctx, current, "profile.uploadAvatar");
    if (fileId !== null && slot === "cover") requirePermission(ctx, current, "profile.uploadCover");
    if (fileId !== null) attachUploadedFile(ctx, user.userId, fileId, slot);
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
      if (fileId === null && previous === null) return null;
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
      if (fileId === null && previous === null) return null;
      ctx.sqlite
        .prepare(`UPDATE nodes SET ${column} = ?1, content_updated_at = ?3 WHERE id = ?2`)
        .run(fileId, nodeId, ctx.now());
    }
    if (previous !== null) releaseFile(ctx, previous);
    publishEvent(ctx, {
      type: "content.edited",
      targetType: nodeId === undefined ? "profile" : "node",
      targetId: nodeId ?? user.userId,
    });
    if (nodeId === undefined)
      ctx.sqlite
        .prepare("UPDATE users SET content_updated_at = ?1 WHERE id = ?2")
        .run(ctx.now(), user.userId);
    if (nodeId !== undefined)
      appendModeratorLog(ctx, actor, `node.${slot}`, "node", nodeId, "", { fileId });
    return publicPicture(ctx, fileId);
  });
}

/**
 * Takes a member's uploaded avatar or cover off their profile and queues the file for deletion,
 * as setting it to nothing does. Call inside a write transaction; false when there was none.
 */
export function clearMemberPicture(ctx: Ctx, userId: number, slot: "avatar" | "cover"): boolean {
  const column = slot === "avatar" ? "avatar_file_id" : "cover_file_id";
  const row = ctx.sqlite
    .prepare<{ previous: number | null }, [number]>(
      `SELECT ${column} AS previous FROM users WHERE id = ?1`,
    )
    .get(userId);
  if (!row) throw new NotFoundError();
  if (row.previous === null) return false;
  ctx.sqlite.prepare(`UPDATE users SET ${column} = NULL WHERE id = ?1`).run(userId);
  releaseFile(ctx, row.previous);
  return true;
}

/** The picture of an award or a shop item; the table and purpose say which. */
function setArtwork(
  ctx: Ctx,
  actor: Actor,
  fileId: number | null,
  target: {
    table: "awards" | "shop_items";
    entity: "award" | "shop_item";
    id: number;
    purpose: "award_image" | "shop_image";
    action: string;
  },
) {
  const user = requireAuthenticated(actor);
  return writeTx(ctx, () => {
    // The administration re-checks inside its transaction, as the rest of the shop does.
    requirePermission(
      ctx,
      currentActor(ctx, actor),
      target.table === "shop_items" ? "admin.shop" : "admin.awards",
    );
    const row = ctx.sqlite
      .prepare<{ previous: number | null }, [number]>(
        `SELECT image_file_id AS previous FROM ${target.table} WHERE id = ?1`,
      )
      .get(target.id);
    if (!row) throw new NotFoundError();
    if (fileId !== null) attachUploadedFile(ctx, user.userId, fileId, target.purpose);
    if (fileId === null && row.previous === null) return null;
    ctx.sqlite
      .prepare(`UPDATE ${target.table} SET image_file_id = ?1, updated_at = ?2 WHERE id = ?3`)
      .run(fileId, ctx.now(), target.id);
    if (row.previous !== null) releaseFile(ctx, row.previous);
    appendModeratorLog(ctx, actor, target.action, target.entity, target.id, "", { fileId });
    return publicPicture(ctx, fileId);
  });
}

export const operations = [
  implement(imagesSetAvatar, (ctx, actor, input) => setImage(ctx, actor, input, "avatar")),
  implement(imagesSetCover, (ctx, actor, input) => setImage(ctx, actor, input, "cover")),
  implement(imagesSetNodeIcon, (ctx, actor, input) => setImage(ctx, actor, input, "node_icon")),
  implement(imagesSetNodeCover, (ctx, actor, input) => setImage(ctx, actor, input, "node_cover")),
  implement(imagesSetAwardImage, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.awards");
    return setArtwork(ctx, actor, input.fileId, {
      table: "awards",
      entity: "award",
      id: input.awardId,
      purpose: "award_image",
      action: "award.image",
    });
  }),
  implement(imagesSetShopItemImage, (ctx, actor, input) => {
    requirePermission(ctx, actor, "admin.shop");
    return setArtwork(ctx, actor, input.fileId, {
      table: "shop_items",
      entity: "shop_item",
      id: input.itemId,
      purpose: "shop_image",
      action: "shop.item.image",
    });
  }),
];
