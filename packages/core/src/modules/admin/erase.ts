import { type Actor, actorUserId, requireAuthenticated } from "../../actor";
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
import { isAwaiting } from "../members/signup-review";
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
  // An erased account is not waiting in the sign-up queue.
  mark: "UPDATE users SET erased_at = ?2, sessions_revoked_at = ?2, signup_review = NULL WHERE id = ?1 AND erased_at IS NULL",
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
 * Closes an account for good, for `users.adminErase` and `users.deleteOwnAccount`. The first
 * transaction marks the member erased, bans them and writes the log entry; every later step takes
 * something away and looks at what is already gone, so running the operation again from any point
 * finishes the job and writes no second entry. What identifies the member goes before the rename,
 * which nothing else waits for. `guard` is the caller's own permission decision: it runs inside the
 * first transaction on the actor read again there, so a permission revoked in another process
 * since the request began stops the erasure before anything is written. `entry` names the log
 * entry the first transaction writes (the default is `member.erase`; rejecting a sign-up writes
 * its own).
 */
export async function eraseMember(
  ctx: Ctx,
  actor: Actor,
  userId: number,
  reason: string,
  guard: (current: Actor) => void,
  entry: { action: string; details: Record<string, unknown> } = {
    action: "member.erase",
    details: {},
  },
): Promise<void> {
  // 1. Mark, ban for good (refused for the last holder of admin.permissions) and log, together.
  writeTx(ctx, () => {
    guard(currentActor(ctx, actor));
    const own = readMember(ctx, userId);
    if (own?.erased_at === null) {
      // The flag goes with the account; the last super admin cannot be erased.
      if (isSuperAdminRow(ctx, userId)) assertOtherSuperAdmin(ctx, userId);
      ctx.sqlite.prepare("UPDATE users SET is_super_admin = 0 WHERE id = ?1").run(userId);
      // An account that waited in the sign-up queue leaves it: its alert clears with it.
      if (isAwaiting(ctx, userId))
        publishEvent(ctx, {
          type: "member.signup_decided",
          targetType: "user",
          targetId: userId,
          payload: { decision: "reject", moderatorId: actorUserId(actor) },
        });
      ctx.sqlite.prepare(eraseSql.mark).run(userId, ctx.now());
      appendModeratorLog(ctx, actor, entry.action, "user", userId, reason, entry.details);
    }
    if (own?.banned_permanently !== 1)
      insertAuthorizedBan(ctx, actor, userId, reason, null, { notify: false });
  });
  let step = "credentials";
  try {
    // 2. Sessions and API keys, then the links and queued mail that could still reach the account.
    await revokeUserCredentials(ctx, userId);
    await deletePendingTokens(ctx, userId);
    step = "identity";
    // 3. Identity, through Better Auth.
    const authContext = await getAuth(ctx).$context;
    const id = String(userId);
    const placeholder = `erased-${userId}@invalid`;
    const now = readMember(ctx, userId);
    if (now && now.email !== placeholder)
      // The old address leaves the delivery records before it is replaced; afterwards it is unknown.
      writeTx(ctx, () => {
        ctx.sqlite.prepare(eraseSql.rejectedAddress).run(now.email);
        ctx.sqlite.prepare(eraseSql.failedMail).run(userId, now.email);
      });
    await authContext.internalAdapter.updateUser(id, {
      ...(now && now.email !== placeholder ? { email: placeholder, emailVerified: false } : {}),
      image: null,
    });
    await authContext.internalAdapter.deleteAccounts(id);
    step = "profile";
    // 4. The forum side: follows, then the profile, the pictures and the queued mail.
    endMemberFollows(ctx, userId);
    writeTx(ctx, () => {
      ctx.sqlite.prepare(eraseSql.clear).run(userId, ctx.now());
      clearMemberPicture(ctx, userId, "avatar");
      clearMemberPicture(ctx, userId, "cover");
      prepared(ctx, "admin.erase.mail", () => ctx.sqlite.prepare(eraseSql.mail)).run(userId);
      ctx.sqlite.prepare(eraseSql.failedMail).run(userId, "");
      ctx.sqlite.prepare(eraseSql.pushDevices).run(userId);
      ctx.sqlite.prepare(ipLogSql.erase).run(userId);
      deleteConsentRecord(ctx, userId);
      ctx.sqlite.prepare(acceptanceSql.erase).run(userId);
      ctx.sqlite.prepare(eraseSql.uncountReferral).run(userId);
      ctx.sqlite.prepare(eraseSql.endReferrals).run(userId);
    });
    step = "name";
    // 5. The name, last. Credentials created since step 2 would go too.
    await renameErased(ctx, userId);
    await revokeUserCredentials(ctx, userId);
    writeTx(ctx, () => {
      ctx.sqlite.prepare(eraseSql.touch).run(ctx.now(), userId);
      markSessionsRevoked(ctx, userId);
      publishEvent(ctx, { type: "content.edited", targetType: "profile", targetId: userId });
    });
  } catch (error) {
    // The account is already erased and banned, so the member cannot run it again: an
    // administrator finishes it with `users.adminErase`, and this line says whose and where.
    console.error("[users.eraseInterrupted]", { userId, step }, error);
    throw error;
  }
}

/**
 * An administrator erases another member: admin.members over them, and admin.permissions when
 * they hold any administration permission (checked again in the first transaction). The caller
 * has verified the actor's own password.
 */
export async function eraseAsAdministrator(
  ctx: Ctx,
  actor: Actor,
  userId: number,
  reason: string,
): Promise<void> {
  const admin = requireAuthenticated(actor);
  if (admin.userId === userId) throw new ConflictError("You cannot erase your own account.");
  const target = targetMember(ctx, actor, userId);
  requirePermission(ctx, actor, "admin.members", { target });
  requireTakeoverRights(ctx, actor, target);
  await eraseMember(ctx, actor, userId, reason, (current) => {
    const fresh = targetMember(ctx, current, userId, true);
    requirePermission(ctx, current, "admin.members", { target: fresh });
    requireTakeoverRights(ctx, current, fresh);
  });
}

export const usersAdminEraseOp = implement(usersAdminErase, async (ctx, actor, input) => {
  requireAuthenticated(actor);
  await verifyActorPassword(ctx, actor, input.actorPassword);
  await eraseAsAdministrator(ctx, actor, input.userId, input.reason);
  return { ok: true as const };
});
