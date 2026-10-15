import type * as z from "zod";
import { type Actor, requireAuthenticated } from "../../actor";
import type { Ctx } from "../../context";
import { usersAdminUpdateProfile } from "../../contracts/admin";
import { writeTx } from "../../db/tx";
import { ForbiddenError, ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { can, currentActor, requirePermission } from "../../permissions";
import { catalogs } from "../appearance/store";
import { clearMemberPicture } from "../images";
import { appendModeratorLog } from "../moderation";
import { profileFieldChanges, storeProfileChanges } from "../profiles/fields";
import { loadAdminMember } from "./members";

/**
 * The member as the editor may see them: whoever holds `admin.members` over them gets the
 * administration view; a moderator who holds only `member.editProfile` gets it without what is
 * private (the address, the last activity, the credits, the verification and the super admin
 * marks).
 */
function viewFor(ctx: Ctx, actor: Actor, userId: number) {
  const view = loadAdminMember(ctx, actor, userId);
  if (view.canEdit) return view;
  return {
    ...view,
    email: null,
    emailVerified: false,
    lastActivityAt: null,
    usernameChangedAt: null,
    credits: 0,
    isSuperAdmin: false,
    canSetSuperAdmin: false,
  };
}

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

/**
 * Who may edit the member: `admin.members` over them, which covers everything, or
 * `member.editProfile`, which covers all but what the member wears (an accent, a name colour,
 * a frame, a cover from the gallery).
 */
function requireProfileEditor(
  ctx: Ctx,
  actor: Actor,
  target: Actor,
  input: { accentId?: unknown; nameColorId?: unknown; frameId?: unknown; coverPresetId?: unknown },
): void {
  if (can(ctx, actor, "admin.members", { target })) return;
  requirePermission(ctx, actor, "member.editProfile", { target });
  if (
    input.accentId !== undefined ||
    input.nameColorId !== undefined ||
    input.frameId !== undefined ||
    input.coverPresetId !== undefined
  )
    throw new ForbiddenError("What a member wears needs administration of members.");
}

/**
 * One administrative edit of a member's profile: the permission over the member (checked again
 * inside the write transaction), the fields, what they wear and the pictures taken off, and one
 * log entry. Answers whether anything was changed (a picture that was not there changes nothing).
 */
export function editMemberProfile(
  ctx: Ctx,
  actor: Actor,
  input: z.output<typeof usersAdminUpdateProfile.input>,
): boolean {
  requireAuthenticated(actor);
  requireProfileEditor(ctx, actor, targetMember(ctx, actor, input.userId), input);
  requireNotErased(ctx, input.userId);
  // A title and a signature are set whether or not the member may show them: no permission asked.
  const { changes } = profileFieldChanges(ctx, input);
  const worn = wearing(input, catalogs(ctx));
  const keys = [...Object.keys(changes), ...Object.keys(worn)];
  const pictures = [
    ...(input.removeAvatar ? (["avatar"] as const) : []),
    ...(input.removeCover ? (["cover"] as const) : []),
  ];
  if (keys.length === 0 && pictures.length === 0) return false;

  return writeTx(ctx, () => {
    // The administrator may have lost the permission since the request began.
    const current = currentActor(ctx, actor);
    requireProfileEditor(ctx, current, targetMember(ctx, current, input.userId, true), input);
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
    if (keys.length === 0 && removed.length === 0) return false;
    appendModeratorLog(ctx, actor, "member.profile", "user", input.userId, input.reason, {
      // Which fields, never what they held.
      fields: keys,
      removed,
    });
    return true;
  });
}

export const usersAdminUpdateProfileOp = implement(usersAdminUpdateProfile, (ctx, actor, input) => {
  editMemberProfile(ctx, actor, input);
  return viewFor(ctx, actor, input.userId);
});
