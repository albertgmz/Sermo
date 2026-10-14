import type * as z from "zod";
import type { Actor } from "../../actor";
import { requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { appearanceGet, appearanceSet, type MemberAppearance } from "../../contracts/appearance";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { can, currentActor, requirePermission } from "../../permissions";
import { heldFrameIds, heldNameColorIds, heldNameIconItemIds, heldNameIcons } from "../shop/held";
import { catalogs } from "./store";

type Appearance = z.infer<typeof MemberAppearance>;

const WORN_SQL =
  "SELECT accent_color_id, name_color_id, frame_id, cover_preset_id, name_icon_item_id FROM users WHERE id = ?1";
interface WornRow {
  accent_color_id: number | null;
  name_color_id: number | null;
  frame_id: number | null;
  cover_preset_id: number | null;
  name_icon_item_id: number | null;
}

/** What the member wears and may choose from, for `actor`'s permissions. */
function appearanceOf(ctx: Ctx, actor: Actor, userId: number): Appearance {
  const worn = prepared(ctx, "appearance.worn", () =>
    ctx.sqlite.prepare<WornRow, [number]>(WORN_SQL),
  ).get(userId);
  if (!worn) throw new NotFoundError();
  const lists = catalogs(ctx);
  const frames = heldFrameIds(ctx, userId);
  const colors = heldNameColorIds(ctx, userId);
  const covers = can(ctx, actor, "profile.coverPreset");
  return {
    accentId: worn.accent_color_id,
    nameColorId: worn.name_color_id,
    frameId: worn.frame_id,
    // A cover from the gallery shows only while its member may use the gallery.
    coverPresetId: covers ? worn.cover_preset_id : null,
    nameIconItemId: worn.name_icon_item_id,
    available: {
      accents: lists.activeColors.accent,
      nameColors: lists.colors.name.filter((color) => colors.has(color.id)),
      frames: lists.images.frame.filter(
        (frame) => frames.has(frame.id) && frame.image && frame.placement,
      ),
      nameIcons: heldNameIcons(ctx, userId).map((held) => ({
        itemId: held.id,
        name: held.name,
        icon: held.icon,
        position: held.position,
      })),
      covers: covers ? lists.visibleImages.profile_cover : [],
    },
  };
}

export const appearanceGetOp = implement(appearanceGet, (ctx, actor) =>
  appearanceOf(ctx, actor, requireAuthenticated(actor).userId),
);

export const appearanceSetOp = implement(appearanceSet, (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, "profile.editOwn");
  if (input.coverPresetId != null) requirePermission(ctx, actor, "profile.coverPreset");
  return writeTx(ctx, () => {
    // The member's permissions and holdings may have changed since the request's actor was resolved.
    const current = currentActor(ctx, actor);
    requirePermission(ctx, current, "profile.editOwn");
    const lists = catalogs(ctx);
    const changes: Partial<Record<keyof WornRow, number | null>> = {};
    if (input.accentId !== undefined) {
      if (input.accentId !== null) {
        const color = lists.colorById.get(input.accentId);
        if (color?.kind !== "accent" || !color.isActive) throw new NotFoundError();
      }
      changes.accent_color_id = input.accentId;
    }
    if (input.nameColorId !== undefined) {
      if (input.nameColorId !== null) {
        if (lists.colorById.get(input.nameColorId)?.kind !== "name") throw new NotFoundError();
        if (!heldNameColorIds(ctx, user.userId).has(input.nameColorId)) throw new ForbiddenError();
      }
      changes.name_color_id = input.nameColorId;
    }
    if (input.frameId !== undefined) {
      if (input.frameId !== null) {
        const frame = lists.imageById.get(input.frameId);
        if (frame?.kind !== "frame") throw new NotFoundError();
        if (!heldFrameIds(ctx, user.userId).has(input.frameId)) throw new ForbiddenError();
        if (!frame.image || !frame.placement)
          throw new ConflictError("This frame has no picture yet.");
      }
      changes.frame_id = input.frameId;
    }
    if (input.nameIconItemId !== undefined) {
      if (
        input.nameIconItemId !== null &&
        !heldNameIconItemIds(ctx, user.userId).has(input.nameIconItemId)
      )
        throw new ForbiddenError();
      changes.name_icon_item_id = input.nameIconItemId;
    }
    if (input.coverPresetId !== undefined) {
      if (input.coverPresetId !== null) {
        requirePermission(ctx, current, "profile.coverPreset");
        const cover = lists.imageById.get(input.coverPresetId);
        if (cover?.kind !== "profile_cover" || !cover.isActive || !cover.image)
          throw new NotFoundError();
      }
      changes.cover_preset_id = input.coverPresetId;
    }
    const columns = Object.keys(changes) as (keyof WornRow)[];
    if (columns.length > 0) {
      ctx.sqlite
        .prepare(
          `UPDATE users SET ${columns.map((column, i) => `${column} = ?${i + 3}`).join(", ")}, content_updated_at = ?2 WHERE id = ?1`,
        )
        .run(user.userId, ctx.now(), ...columns.map((column) => changes[column]!));
      publishEvent(ctx, { type: "content.edited", targetType: "profile", targetId: user.userId });
    }
    return appearanceOf(ctx, current, user.userId);
  });
});

export const wearingOperations = [appearanceGetOp, appearanceSetOp];
