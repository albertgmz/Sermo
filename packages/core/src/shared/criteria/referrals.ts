import { counted, flag, withValue } from "./build";
import type { Spec } from "./types";

/**
 * Who brought whom. The referrer is recorded on the referred member (`users.referred_by`, with
 * `referred_at`) and counted on the referrer's row; how that record gets made is not the
 * engine's business.
 */
export const referralSpecs: readonly Spec[] = [
  withValue("referrals_at_least", "atLeast", "count", "member", (f, v) => f.referralCount >= v),
  flag("was_referred", (f) => f.wasReferred),
  // Members brought in since the first of this month (UTC): a seek into (referrer, date) for
  // each member, covering. One row per referral; the loader adds them up.
  counted("referrals_this_month", {
    shape: "scalar",
    sql:
      "SELECT referred_by AS user_id, NULL AS id, 1 AS n FROM users INDEXED BY users_referrer_referred " +
      "WHERE referred_by IN (SELECT value FROM json_each(?1)) AND referred_at >= ?5",
  }),
];
