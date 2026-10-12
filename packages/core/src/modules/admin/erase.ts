import { requireAuthenticated } from "../../actor";
import { prepared } from "../../context";
import { usersAdminErase } from "../../contracts/admin";
import { writeTx } from "../../db/tx";
import { ConflictError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { currentActor, requirePermission } from "../../permissions";
import { getAuth, revokeUserCredentials } from "../auth";
import { renameThroughAuth } from "../auth/username";
import { clearMemberPicture } from "../images";
import { appendModeratorLog, insertAuthorizedBan } from "../moderation";
import { endMemberFollows } from "../social";
import { targetMember, verifyActorPassword } from "./shared";

const MEMBER_SQL =
  "SELECT u.username, u.username_key, u.banned_permanently, a.email FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1";

const CLEAR_SQL =
  "UPDATE users SET about = '', custom_title = NULL, signature_source = NULL, signature_html = NULL, location = '', website = '', birthday_md = NULL, birth_year = NULL, social_discord = '', social_telegram = '', social_x = '', accent_color_id = NULL, name_color_id = NULL, frame_id = NULL, cover_preset_id = NULL, content_updated_at = ?2 WHERE id = ?1";

/**
 * Closes an account for good. The order leaves a failure at any point with an account nobody can
 * use: the ban comes first, then the credentials go, then the identity and the profile. Every
 * step looks at what is already done, so running it again finishes a half-erased member.
 */
export const usersAdminEraseOp = implement(usersAdminErase, async (ctx, actor, input) => {
  const admin = requireAuthenticated(actor);
  await verifyActorPassword(ctx, actor, input.actorPassword);
  if (admin.userId === input.userId) throw new ConflictError("You cannot erase your own account.");
  requirePermission(ctx, actor, "admin.members", {
    target: targetMember(ctx, actor, input.userId),
  });
  const read = () =>
    prepared(ctx, "admin.erase.member", () =>
      ctx.sqlite.prepare<
        { username: string; username_key: string; banned_permanently: number; email: string },
        [number]
      >(MEMBER_SQL),
    ).get(input.userId);

  // 1. Ban for good (refused for the last holder of admin.permissions).
  writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    requirePermission(ctx, current, "admin.members", {
      target: targetMember(ctx, current, input.userId, true),
    });
    if (read()?.banned_permanently !== 1)
      insertAuthorizedBan(ctx, actor, input.userId, input.reason, null, { notify: false });
  });
  // 2. Sessions and API keys.
  await revokeUserCredentials(ctx, input.userId);
  // 3. Identity, through Better Auth.
  const authContext = await getAuth(ctx).$context;
  const id = String(input.userId);
  const placeholder = `erased-${input.userId}@invalid`;
  const name = `Deleted member ${input.userId}`;
  const now = read();
  if (now && now.email !== placeholder)
    await authContext.internalAdapter.updateUser(id, { email: placeholder, emailVerified: false });
  await authContext.internalAdapter.deleteAccounts(id);
  if (now && now.username !== name)
    await renameThroughAuth(ctx, input.userId, name, now.username_key);
  // Credentials created since step 2 (a sign-in cannot, the member is banned) would go too.
  await revokeUserCredentials(ctx, input.userId);
  // 4. The forum side: follows, then the profile, the pictures and the log.
  endMemberFollows(ctx, input.userId);
  writeTx(ctx, () => {
    ctx.sqlite.prepare(CLEAR_SQL).run(input.userId, ctx.now());
    clearMemberPicture(ctx, input.userId, "avatar");
    clearMemberPicture(ctx, input.userId, "cover");
    ctx.sqlite
      .prepare("UPDATE users SET username_changed_at = ?1 WHERE id = ?2")
      .run(ctx.now(), input.userId);
    publishEvent(ctx, { type: "content.edited", targetType: "profile", targetId: input.userId });
    appendModeratorLog(ctx, actor, "member.erase", "user", input.userId, input.reason, {});
  });
  return { ok: true as const };
});
