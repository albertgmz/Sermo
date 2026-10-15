import { requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { usersAdminErase } from "../../contracts/admin";
import { writeTx } from "../../db/tx";
import { ConflictError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { currentActor, requirePermission } from "../../permissions";
import { deletePendingTokens, getAuth, markSessionsRevoked, revokeUserCredentials } from "../auth";
import { renameThroughAuth } from "../auth/username";
import { deleteConsentRecord } from "../consent";
import { clearMemberPicture } from "../images";
import { appendModeratorLog, insertAuthorizedBan } from "../moderation";
import { acceptanceSql } from "../pages/acceptance";
import { ipLogSql } from "../security/log";
import { endMemberFollows } from "../social";
import { requireTakeoverRights, targetMember, verifyActorPassword } from "./shared";
import { assertOtherSuperAdmin, isSuperAdminRow } from "./super-admin";

interface MemberRow {
  username: string;
  username_key: string;
  banned_permanently: number;
  erased_at: number | null;
  email: string;
}
export const eraseSql = {
  member:
    "SELECT u.username, u.username_key, u.banned_permanently, u.erased_at, a.email FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1",
  mark: "UPDATE users SET erased_at = ?2, sessions_revoked_at = ?2 WHERE id = ?1 AND erased_at IS NULL",
  holder: "SELECT id FROM users WHERE username_key = ?1",
  // Every account email of the member that is not running, finished ones included: they hold the address.
  mail: "DELETE FROM jobs WHERE type = 'email.account' AND status <> 'running' AND json_extract(payload, '$.userId') = ?1",
  rejectedAddress: "DELETE FROM undeliverable_emails WHERE email = ?1",
  failedMail: "DELETE FROM email_failures WHERE user_id = ?1 OR email = ?2",
  pushDevices: "DELETE FROM push_subscriptions WHERE user_id = ?1",
  // The referrer loses one referral; the member's own links, and the links of those they referred, end.
  uncountReferral:
    "UPDATE users SET referral_count = max(referral_count - 1, 0) WHERE id = (SELECT referred_by FROM users WHERE id = ?1)",
  endReferrals:
    "UPDATE users SET referred_by = NULL, referred_at = NULL, referral_count = CASE WHEN id = ?1 THEN 0 ELSE referral_count END WHERE id = ?1 OR referred_by = ?1",
  clear:
    "UPDATE users SET about = '', custom_title = NULL, signature_source = NULL, signature_html = NULL, location = '', website = '', birthday_md = NULL, birth_year = NULL, social_discord = '', social_telegram = '', social_x = '', accent_color_id = NULL, name_color_id = NULL, frame_id = NULL, name_icon_item_id = NULL, cover_preset_id = NULL, content_updated_at = ?2 WHERE id = ?1",
  touch: "UPDATE users SET content_updated_at = ?1, username_changed_at = ?1 WHERE id = ?2",
};

/** The numbers tried after `Deleted member <id>` when that name is somehow taken. */
const SUFFIXES = 20;

function readMember(ctx: Ctx, userId: number): MemberRow | undefined {
  return (
    prepared(ctx, "admin.erase.member", () =>
      ctx.sqlite.prepare<MemberRow, [number]>(eraseSql.member),
    ).get(userId) ?? undefined
  );
}

/**
 * Gives the erased member their name: `Deleted member <id>`, or the first free
 * `Deleted member <id>-<n>` when that one is held by someone else (an account from before the
 * name was reserved). Nothing else depends on this step, so it runs last.
 */
async function renameErased(ctx: Ctx, userId: number): Promise<void> {
  const own = readMember(ctx, userId);
  if (!own) return;
  const base = `Deleted member ${userId}`;
  if (new RegExp(`^${base.toLowerCase()}(-[0-9]+)?$`).test(own.username_key)) return;
  for (let n = 0; n <= SUFFIXES; n++) {
    const name = n === 0 ? base : `${base}-${n}`;
    const holder = prepared(ctx, "admin.erase.holder", () =>
      ctx.sqlite.prepare<{ id: number }, [string]>(eraseSql.holder),
    ).get(name.toLowerCase());
    if (holder && holder.id !== userId) continue;
    try {
      await renameThroughAuth(ctx, userId, name, own.username_key, { reserved: true });
      return;
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
    }
  }
  throw new ConflictError("No free name was found for the erased account.");
}

/**
 * Closes an account for good. The first transaction marks the member erased, bans them and
 * writes the log entry; every later step takes something away and looks at what is already gone,
 * so running the operation again from any point finishes the job and writes no second entry.
 * What identifies the member goes before the rename, which nothing else waits for.
 */
export const usersAdminEraseOp = implement(usersAdminErase, async (ctx, actor, input) => {
  const admin = requireAuthenticated(actor);
  await verifyActorPassword(ctx, actor, input.actorPassword);
  if (admin.userId === input.userId) throw new ConflictError("You cannot erase your own account.");
  const target = targetMember(ctx, actor, input.userId);
  requirePermission(ctx, actor, "admin.members", { target });
  requireTakeoverRights(ctx, actor, target);

  // 1. Mark, ban for good (refused for the last holder of admin.permissions) and log, together.
  writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    const fresh = targetMember(ctx, current, input.userId, true);
    requirePermission(ctx, current, "admin.members", { target: fresh });
    requireTakeoverRights(ctx, current, fresh);
    const own = readMember(ctx, input.userId);
    if (own?.erased_at === null) {
      // The flag goes with the account; the last super admin cannot be erased.
      if (isSuperAdminRow(ctx, input.userId)) assertOtherSuperAdmin(ctx, input.userId);
      ctx.sqlite.prepare("UPDATE users SET is_super_admin = 0 WHERE id = ?1").run(input.userId);
      ctx.sqlite.prepare(eraseSql.mark).run(input.userId, ctx.now());
      appendModeratorLog(ctx, actor, "member.erase", "user", input.userId, input.reason, {});
    }
    if (own?.banned_permanently !== 1)
      insertAuthorizedBan(ctx, actor, input.userId, input.reason, null, { notify: false });
  });
  // 2. Sessions and API keys, then the links and queued mail that could still reach the account.
  await revokeUserCredentials(ctx, input.userId);
  await deletePendingTokens(ctx, input.userId);
  // 3. Identity, through Better Auth.
  const authContext = await getAuth(ctx).$context;
  const id = String(input.userId);
  const placeholder = `erased-${input.userId}@invalid`;
  const now = readMember(ctx, input.userId);
  if (now && now.email !== placeholder)
    // The old address leaves the delivery records before it is replaced; afterwards it is unknown.
    writeTx(ctx, () => {
      ctx.sqlite.prepare(eraseSql.rejectedAddress).run(now.email);
      ctx.sqlite.prepare(eraseSql.failedMail).run(input.userId, now.email);
    });
  await authContext.internalAdapter.updateUser(id, {
    ...(now && now.email !== placeholder ? { email: placeholder, emailVerified: false } : {}),
    image: null,
  });
  await authContext.internalAdapter.deleteAccounts(id);
  // 4. The forum side: follows, then the profile, the pictures and the queued mail.
  endMemberFollows(ctx, input.userId);
  writeTx(ctx, () => {
    ctx.sqlite.prepare(eraseSql.clear).run(input.userId, ctx.now());
    clearMemberPicture(ctx, input.userId, "avatar");
    clearMemberPicture(ctx, input.userId, "cover");
    prepared(ctx, "admin.erase.mail", () => ctx.sqlite.prepare(eraseSql.mail)).run(input.userId);
    ctx.sqlite.prepare(eraseSql.failedMail).run(input.userId, "");
    ctx.sqlite.prepare(eraseSql.pushDevices).run(input.userId);
    ctx.sqlite.prepare(ipLogSql.erase).run(input.userId);
    deleteConsentRecord(ctx, input.userId);
    ctx.sqlite.prepare(acceptanceSql.erase).run(input.userId);
    ctx.sqlite.prepare(eraseSql.uncountReferral).run(input.userId);
    ctx.sqlite.prepare(eraseSql.endReferrals).run(input.userId);
  });
  // 5. The name, last. Credentials created since step 2 would go too.
  await renameErased(ctx, input.userId);
  await revokeUserCredentials(ctx, input.userId);
  writeTx(ctx, () => {
    ctx.sqlite.prepare(eraseSql.touch).run(ctx.now(), input.userId);
    markSessionsRevoked(ctx, input.userId);
    publishEvent(ctx, { type: "content.edited", targetType: "profile", targetId: input.userId });
  });
  return { ok: true as const };
});
