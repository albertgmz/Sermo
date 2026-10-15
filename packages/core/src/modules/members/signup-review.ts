import { type Ctx, prepared } from "../../context";
import type { SignupReview } from "../../db/schema";
import { publishEvent } from "../../events";
import { AWAITING_SQL } from "../../permissions";
import { enqueueJob } from "../jobs/queue";
import { readSiteSettings } from "../settings";

/*
 * The sign-up approval queue. While `approveSignups` is on, a new account is stored with a
 * `signup_review` mark; it "awaits approval" once its email is confirmed too (see
 * `AWAITING_SQL`). Staff decide in `modules/admin/signups.ts`, which clears the mark.
 */

/** The mark a new account is stored with: none while the site approves nothing by hand. */
export function signupReviewFor(ctx: Ctx, flagged: boolean): SignupReview | null {
  // A sign-up the spam check flagged is kept even if the setting was turned off meanwhile.
  if (flagged) return "flagged";
  return readSiteSettings(ctx).approveSignups ? "pending" : null;
}

/**
 * The accounts the queue lists and counts: waiting, and not held back by a ban in force (a ban for
 * good closes the account, one for a time returns it to the queue when it ends). An account whose
 * erasure stopped part way is banned for good but still waiting (the erasure clears the hold at its
 * last step): it stays listed, so staff can finish it. `now` is the number of the parameter that
 * carries the time.
 */
export const inQueueSql = (now: number): string =>
  `${AWAITING_SQL} AND (u.erased_at IS NOT NULL OR (u.banned_permanently = 0 AND (u.banned_until IS NULL OR u.banned_until <= ?${now})))`;

/** Whether the account waits for staff right now. */
export function isAwaiting(ctx: Ctx, userId: number): boolean {
  return !!prepared(ctx, "members.awaiting", () =>
    ctx.sqlite.prepare<{ id: number }, [number]>(
      `SELECT u.id FROM users u WHERE u.id = ?1 AND ${AWAITING_SQL}`,
    ),
  ).get(userId);
}

/** Whether the account is in the queue now (waiting, and not held back by a ban in force). */
export function isInQueue(ctx: Ctx, userId: number): boolean {
  return !!prepared(ctx, "members.inQueue", () =>
    ctx.sqlite.prepare<{ id: number }, [number, number]>(
      `SELECT u.id FROM users u WHERE u.id = ?1 AND ${inQueueSql(2)}`,
    ),
  ).get(userId, ctx.now());
}

/**
 * A ban was just put on the account (inside the ban's transaction, after its row). The standing
 * sign-up alert follows the queue: an account that left it (`wasInQueue`) is announced as decided,
 * so the alert is recomputed, and a ban that ends brings a waiting account back: a job at that time
 * announces it again if it is in the queue then.
 */
export function afterBan(
  ctx: Ctx,
  userId: number,
  wasInQueue: boolean,
  expiresAt: number | null,
): void {
  if (wasInQueue)
    publishEvent(ctx, {
      type: "member.signup_decided",
      targetType: "user",
      targetId: userId,
      payload: { decision: "ban" },
    });
  if (expiresAt !== null && isAwaiting(ctx, userId))
    enqueueJob(
      ctx,
      "signups.reannounce",
      { userId },
      { runAt: expiresAt + 1000, uniqueKey: `signups.reannounce:${userId}:${expiresAt}` },
    );
}

/** A ban was just lifted: an account that is back in the queue is announced again. */
export function afterLift(ctx: Ctx, userId: number): void {
  if (isInQueue(ctx, userId)) announceWaiting(ctx, userId);
}

/** Tells the staff who hold the permission that an account now waits (inside the caller's write transaction). */
export function announceWaiting(ctx: Ctx, userId: number): void {
  publishEvent(ctx, {
    type: "member.awaiting_approval",
    targetType: "user",
    targetId: userId,
    // The newcomer is the alert's actor: one standing alert per staff member lists the newest.
    payload: { userId },
  });
}
