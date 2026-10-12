import { requireAuthenticated } from "../../actor";
import { usersAdminUpdateProfile } from "../../contracts/admin";
import { writeTx } from "../../db/tx";
import { ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { currentActor, requirePermission } from "../../permissions";
import { catalogs } from "../appearance/store";
import { clearMemberPicture } from "../images";
import { appendModeratorLog } from "../moderation";
import { profileFieldChanges, storeProfileChanges } from "../profiles/fields";
import { loadAdminMember } from "./members";
import { requireNotErased, targetMember } from "./shared";

const unavailable = () => new ValidationError("That catalog entry is not available.");

/**
 * What a member wears, for an administrator: any active entry of the right catalog and kind,
 * whether or not the member holds it. Null takes it off.
 */
function wearing(
  input: {
    accentId?: number | null;
    nameColorId?: number | null;
    frameId?: number | null;
    coverPresetId?: number | null;
  },
  lists: ReturnType<typeof catalogs>,
): Record<string, number | null> {
  const changes: Record<string, number | null> = {};
  if (input.accentId !== undefined) {
    if (input.accentId !== null) {
      const color = lists.colorById.get(input.accentId);
      if (color?.kind !== "accent" || !color.isActive) throw unavailable();
    }
    changes.accent_color_id = input.accentId;
  }
  if (input.nameColorId !== undefined) {
    if (input.nameColorId !== null) {
      const color = lists.colorById.get(input.nameColorId);
      if (color?.kind !== "name" || !color.isActive) throw unavailable();
    }
    changes.name_color_id = input.nameColorId;
  }
  if (input.frameId !== undefined) {
    if (input.frameId !== null) {
      const frame = lists.imageById.get(input.frameId);
      if (frame?.kind !== "frame" || !frame.isActive || !frame.image || !frame.placement)
        throw unavailable();
    }
    changes.frame_id = input.frameId;
  }
  if (input.coverPresetId !== undefined) {
    if (input.coverPresetId !== null) {
      const cover = lists.imageById.get(input.coverPresetId);
      if (cover?.kind !== "profile_cover" || !cover.isActive || !cover.image) throw unavailable();
    }
    changes.cover_preset_id = input.coverPresetId;
  }
  return changes;
}

export const usersAdminUpdateProfileOp = implement(usersAdminUpdateProfile, (ctx, actor, input) => {
  requireAuthenticated(actor);
  requirePermission(ctx, actor, "admin.members", {
    target: targetMember(ctx, actor, input.userId),
  });
  requireNotErased(ctx, input.userId);
  // A title and a signature are set whether or not the member may show them: no permission asked.
  const { changes } = profileFieldChanges(ctx, input);
  const worn = wearing(input, catalogs(ctx));
  const keys = [...Object.keys(changes), ...Object.keys(worn)];
  const pictures = [
    ...(input.removeAvatar ? (["avatar"] as const) : []),
    ...(input.removeCover ? (["cover"] as const) : []),
  ];
  if (keys.length === 0 && pictures.length === 0) return loadAdminMember(ctx, actor, input.userId);

  writeTx(ctx, () => {
    // The administrator may have lost the permission since the request began.
    const current = currentActor(ctx, actor);
    requirePermission(ctx, current, "admin.members", {
      target: targetMember(ctx, current, input.userId, true),
    });
    requireNotErased(ctx, input.userId);
    storeProfileChanges(ctx, input.userId, { ...changes, ...worn });
    const removed = pictures.filter((slot) => clearMemberPicture(ctx, input.userId, slot));
    if (removed.length > 0) {
      ctx.sqlite
        .prepare("UPDATE users SET content_updated_at = ?1 WHERE id = ?2")
        .run(ctx.now(), input.userId);
      publishEvent(ctx, { type: "content.edited", targetType: "profile", targetId: input.userId });
    }
    // A picture that was not there changes nothing, and leaves nothing to log.
    if (keys.length === 0 && removed.length === 0) return;
    appendModeratorLog(ctx, actor, "member.profile", "user", input.userId, input.reason, {
      // Which fields, never what they held.
      fields: keys,
      removed,
    });
  });
  return loadAdminMember(ctx, actor, input.userId);
});
