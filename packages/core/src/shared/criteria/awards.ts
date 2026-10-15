import type { Ctx } from "../../context";
import type { DomainEvent } from "../../events";
import { listed, refreshing, withValue } from "./build";
import type { Spec } from "./types";

/** The member whose awards a grant or a revocation changed. */
const holder = (_ctx: Ctx, event: DomainEvent) => [event.targetId];
const AWARD_EVENTS = ["award.granted", "award.revoked"] as const;

/**
 * The awards a member holds. Their counts sit on the member's row; which awards are held is one
 * seek per listed award. Giving or taking an award away checks the member's other awards again,
 * which is why an award may not depend on itself (the save refuses it).
 */
export const awardSpecs: readonly Spec[] = [
  refreshing(
    withValue("awards_held_at_least", "atLeast", "count", "member", (f, v) => f.awardCount >= v),
    AWARD_EVENTS,
    holder,
  ),
  refreshing(
    withValue("award_xp_at_most", "atMost", "points", "member", (f, v) => f.awardXp <= v),
    AWARD_EVENTS,
    holder,
  ),
  listed(
    "holds_awards",
    "awards",
    {
      shape: "perId",
      sql:
        "SELECT t.user_id AS user_id, t.award_id AS id, t.count AS n FROM member_award_totals t INDEXED BY member_award_totals_user_award " +
        "WHERE t.user_id IN (SELECT value FROM json_each(?1)) AND t.award_id IN (SELECT value FROM json_each(?2)) AND t.count > 0",
    },
    {
      modes: ["one", "none", "each"],
      cost: "cheap",
      refresh: { on: AWARD_EVENTS, members: holder },
    },
  ),
];
