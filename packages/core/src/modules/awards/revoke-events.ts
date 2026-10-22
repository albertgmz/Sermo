import type { Ctx } from "../../context";
import type { DomainEvent } from "../../events";
import { one } from "./store";

/** What a grant taken back by the run says about why: the mark of the events it publishes. */
export const REVOKE_REASON = "The member no longer meets the rule of the award.";

/**
 * Whether the event comes from a grant the run that takes back awards (`revoke.ts`) revoked: its
 * `award.revoked` event, or the `credits.changed` of the credits taken back with it. The run
 * judged the member with what it left them, and a run can publish an event or two for each of
 * hundreds of thousands of grants, so the subscribers that look at a member again after most
 * events (awards, promotions) leave these out; what the revocation makes true for a rule is
 * picked up by their daily sweeps.
 */
export function isRevokeRunEvent(ctx: Ctx, event: DomainEvent): boolean {
  if (event.type === "award.revoked") return event.payload.reason === REVOKE_REASON;
  if (event.type !== "credits.changed" || event.payload.type !== "award_revoked") return false;
  return (
    one<{ reason: string }>(
      ctx,
      "revokeEventReason",
      "SELECT reason FROM credit_transactions WHERE id = ?1",
      Number(event.payload.transactionId),
    )?.reason === REVOKE_REASON
  );
}
