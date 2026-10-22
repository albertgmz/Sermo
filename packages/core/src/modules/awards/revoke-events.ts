import type { DomainEvent } from "../../events";

/**
 * The source type of the credits the run that takes back awards (`revoke.ts`) takes back, in the
 * ledger and in the `credits.changed` event, as `unqualified: true` marks its `award.revoked`
 * event. Only the run writes them: they are fields members never see as text, and no wording
 * can switch them off.
 */
export const UNQUALIFIED_SOURCE = "member_award_unqualified";

/**
 * Whether the event comes from a grant that run revoked. The run judged the member with what it
 * left them, and it can publish an event or two for each of hundreds of thousands of grants, so
 * the subscribers that look at a member again after most events (awards, promotions) leave
 * these out; what a revocation makes true for a rule is picked up by their daily sweeps.
 */
export function isRevokeRunEvent(event: DomainEvent): boolean {
  if (event.type === "award.revoked") return event.payload.unqualified === true;
  return (
    event.type === "credits.changed" &&
    event.payload.type === "award_revoked" &&
    event.payload.sourceType === UNQUALIFIED_SOURCE
  );
}
