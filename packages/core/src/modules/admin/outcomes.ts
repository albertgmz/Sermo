import type * as z from "zod";
import type { MemberOutcome, MemberOutcomes } from "../../contracts/batch";
import { ConflictError, ForbiddenError, NotFoundError, SermoError } from "../../errors";

/** A rule that says a member is left as they are (not an error the actor could fix). */
export class SkipMember extends Error {}

type Outcome = z.output<typeof MemberOutcome>;

/**
 * Runs the change for one member of a batch and reports it. A refusal by a rule (the actor may
 * not act on the member, a conflict with another rule, a member who is gone) is `skipped`; any
 * other error the change raised is `failed`. Nothing here stops the batch: the members after
 * this one still run, and what was changed before stays changed.
 */
export async function outcomeOf(
  userId: number | null,
  name: string,
  work: () => void | Promise<void>,
): Promise<Outcome> {
  try {
    await work();
    return { userId, name, status: "done", message: null };
  } catch (error) {
    if (
      error instanceof SkipMember ||
      error instanceof ForbiddenError ||
      error instanceof ConflictError ||
      error instanceof NotFoundError
    )
      return { userId, name, status: "skipped", message: error.message };
    if (error instanceof SermoError)
      return { userId, name, status: "failed", message: error.message };
    console.error("[members.batch]", { userId }, error);
    return { userId, name, status: "failed", message: "The change failed." };
  }
}

/** The answer of a batch: the outcomes in order and how many of each kind. */
export function tally(items: Outcome[]): z.output<typeof MemberOutcomes> {
  const count = (status: Outcome["status"]) =>
    items.filter((item) => item.status === status).length;
  return { items, done: count("done"), skipped: count("skipped"), failed: count("failed") };
}
