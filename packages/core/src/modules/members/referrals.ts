import { type Ctx, prepared } from "../../context";
import { GROUP_IDS } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { isBanned } from "./access";

/** A referrer counts only while the referred member's account is younger than this. */
export const REFERRAL_WINDOW_MS = 7 * 86_400_000;

interface MemberRow {
  group_id: number;
  created_at: number;
  referred_by: number | null;
  pending_referrer: number | null;
  banned_until: number | null;
  banned_permanently: number;
  erased_at: number | null;
}

const memberRow = (ctx: Ctx, userId: number) =>
  prepared(ctx, "members.referralRow", () =>
    ctx.sqlite.prepare<MemberRow, [number]>(
      "SELECT group_id, created_at, referred_by, pending_referrer, banned_until, banned_permanently, erased_at FROM users WHERE id = ?1",
    ),
  ).get(userId);

/** The member id a client wrote as the referrer: a positive whole number, or null. */
export function parseReferrer(value: unknown): number | null {
  const id =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[1-9]\d{0,15}$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Whether `referrerId` may bring `userId`: another member, not banned, not erased and not still
 * waiting to confirm their address, who was not brought by `userId` in turn. Call it inside the write transaction that records the referral.
 */
function mayRefer(ctx: Ctx, userId: number, referrerId: number): boolean {
  if (referrerId === userId) return false;
  const referrer = memberRow(ctx, referrerId);
  return (
    !!referrer &&
    referrer.erased_at === null &&
    referrer.group_id !== GROUP_IDS.unconfirmed &&
    !isBanned(referrer, ctx.now()) &&
    referrer.referred_by !== userId
  );
}

/**
 * Records `referrerId` as the member who brought `userId`, and counts it on the referrer, once:
 * only while the member has no referrer and is within the first seven days. Returns whether it
 * was recorded; a refused referrer changes nothing. Call it inside a write transaction.
 */
export function recordReferral(ctx: Ctx, userId: number, referrerId: number): boolean {
  const member = memberRow(ctx, userId);
  if (!member || member.referred_by !== null) return false;
  if (ctx.now() - member.created_at >= REFERRAL_WINDOW_MS) return false;
  if (!mayRefer(ctx, userId, referrerId)) return false;
  const changed = prepared(ctx, "members.recordReferral", () =>
    ctx.sqlite.prepare<unknown, [number, number, number]>(
      "UPDATE users SET referred_by = ?1, referred_at = ?2 WHERE id = ?3 AND referred_by IS NULL",
    ),
  ).run(referrerId, ctx.now(), userId).changes;
  if (changed === 0) return false;
  prepared(ctx, "members.countReferral", () =>
    ctx.sqlite.prepare<unknown, [number]>(
      "UPDATE users SET referral_count = referral_count + 1 WHERE id = ?1",
    ),
  ).run(referrerId);
  return true;
}

/**
 * A registration that names a referrer. A member who still has to confirm their address is only
 * marked with it (`pending_referrer`): it is recorded once the address is confirmed (see
 * `settlePendingReferral`), so an address nobody confirmed brings no referral. Any other member's
 * referrer is recorded now.
 * A referrer that cannot be used is dropped; it never fails the registration. Call it inside the
 * write transaction that inserts the member.
 */
export function referOnRegistration(
  ctx: Ctx,
  userId: number,
  referrerId: number,
  confirmFirst: boolean,
): void {
  if (!confirmFirst) {
    recordReferral(ctx, userId, referrerId);
    return;
  }
  if (!mayRefer(ctx, userId, referrerId)) return;
  prepared(ctx, "members.pendingReferrer", () =>
    ctx.sqlite.prepare<unknown, [number, number]>(
      "UPDATE users SET pending_referrer = ?1 WHERE id = ?2 AND referred_by IS NULL",
    ),
  ).run(referrerId, userId);
}

/**
 * Takes the member's pending referrer, if they have one, and records it when it still may be.
 * The pending marker is cleared whatever the outcome, so it is tried once. Call it inside a write
 * transaction.
 */
export function settlePendingReferral(ctx: Ctx, userId: number): boolean {
  const member = memberRow(ctx, userId);
  if (!member || member.pending_referrer === null) return false;
  prepared(ctx, "members.clearPendingReferrer", () =>
    ctx.sqlite.prepare<unknown, [number]>("UPDATE users SET pending_referrer = NULL WHERE id = ?1"),
  ).run(userId);
  return recordReferral(ctx, userId, member.pending_referrer);
}

/**
 * At a sign-in: settles a pending referrer of a member whose address is confirmed (for one who
 * confirmed by a way that does not promote them), and leaves it held for one who is not. It reads
 * first and opens a write transaction only for a member who has one, so an ordinary sign-in
 * writes nothing here. A failure is logged and never refuses the sign-in.
 */
export function settleReferralAtSignIn(ctx: Ctx, userId: number): void {
  try {
    const held = prepared(ctx, "members.pendingReferrerRead", () =>
      ctx.sqlite.prepare<{ pending_referrer: number | null; email_verified: number }, [number]>(
        "SELECT u.pending_referrer, a.email_verified FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1",
      ),
    ).get(userId);
    if (!held || held.pending_referrer === null || !held.email_verified) return;
    writeTx(ctx, () => settlePendingReferral(ctx, userId));
  } catch (error) {
    console.error("The referral could not be recorded", error);
  }
}
