import { APIError } from "better-auth";
import { type Actor, requireAuthenticated } from "../../actor";
import type { Ctx } from "../../context";
import { authChooseUsername, type SignupProfile } from "../../contracts/auth";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, ValidationError } from "../../errors";
import { implement } from "../../operation";
import { accountEmailEnabled, queueAccountEmail } from "../email/account";
import { isAwaiting } from "../members/signup-review";
import { recordSignUpAcceptance } from "../pages/acceptance";
import { storeProfileChanges } from "../profiles/fields";
import { promoteVerifiedMember } from "./index";
import { planSignup, type SignupPlan } from "./registration";
import { checkUsername, renameThroughAuth } from "./username";

/** The site's registration rules for the profile the member gives, as the forum's own errors. */
function signupPlan(ctx: Ctx, profile: SignupProfile | undefined) {
  try {
    return planSignup(ctx, { profile }, accountEmailEnabled(ctx));
  } catch (error) {
    if (!(error instanceof APIError)) throw error;
    const message = (error.body as { message?: string } | undefined)?.message ?? error.message;
    throw error.statusCode === 403 ? new ForbiddenError(message) : new ValidationError(message);
  }
}

const ALREADY_CHOSEN = "Your username is already chosen.";

/**
 * The members whose choice is being made now, per context. The rename is Better Auth's own async
 * write and cannot share our transaction, so a second request is refused here, in the same
 * synchronous step that read `needs_username = 1`, before it can rename anything. The backend
 * serves the API from one process; the transaction below still takes the choice only once.
 */
const choosing = new WeakMap<Ctx, Set<number>>();

function startChoice(ctx: Ctx, userId: number): () => void {
  let members = choosing.get(ctx);
  if (!members) {
    members = new Set();
    choosing.set(ctx, members);
  }
  if (members.has(userId)) throw new ConflictError(ALREADY_CHOSEN);
  members.add(userId);
  const held = members;
  return () => held.delete(userId);
}

export const authChooseUsernameOp = implement(
  authChooseUsername,
  async (ctx, actor, input) => {
    const { userId } = requireAuthenticated(actor);
    // Refused before the input is read: a member with a username of their own may send nothing.
    const own = ctx.sqlite
      .prepare<{ username_key: string; needs_username: number }, [number]>(
        "SELECT username_key, needs_username FROM users WHERE id = ?1",
      )
      .get(userId);
    if (!own?.needs_username) throw new ConflictError(ALREADY_CHOSEN);
    const plan = signupPlan(ctx, input.profile);
    const key = checkUsername(input.username);
    const holder = ctx.sqlite
      .prepare<{ id: number }, [string]>("SELECT id FROM users WHERE username_key = ?1")
      .get(key);
    if (holder && holder.id !== userId) throw new ConflictError("That username is taken.");
    // No `await` from the `needs_username` read above to here.
    const finish = startChoice(ctx, userId);
    try {
      return await choose(ctx, actor, { userId, name: input.username, key, own, plan });
    } finally {
      finish();
    }
  },
  {
    public:
      "Completes the caller's own account, once, and only one a sign-in provider made; it grants nothing.",
  },
);

/** Sets the chosen name, then takes the choice with the terms, profile and promotion. */
async function choose(
  ctx: Ctx,
  actor: Actor,
  choice: {
    userId: number;
    name: string;
    key: string;
    own: { username_key: string };
    plan: SignupPlan;
  },
): Promise<{ username: string }> {
  const { userId, name, key, own, plan } = choice;
  // The name first (Better Auth's own write, outside any transaction of ours). The choice is
  // taken last, in the one transaction that records the terms and moves the member: if anything
  // fails before it commits, the member still needs a username and can try again.
  await renameThroughAuth(ctx, userId, name, own.username_key);
  const identity = ctx.sqlite
    .prepare<{ email: string; email_verified: number }, [number]>(
      "SELECT email, email_verified FROM auth_user WHERE id = ?1",
    )
    .get(userId)!;
  const promoted = writeTx(ctx, () => {
    // Taken once: a second request, or one whose name another request replaced meanwhile,
    // changes no row and is refused.
    const taken = ctx.sqlite
      .prepare(
        "UPDATE users SET needs_username = 0 WHERE id = ?1 AND needs_username = 1 AND username_key = ?2",
      )
      .run(userId, key).changes;
    if (taken === 0) throw new ConflictError(ALREADY_CHOSEN);
    recordSignUpAcceptance(ctx, userId, actor.clientIp);
    storeProfileChanges(ctx, userId, plan.columns, false);
    // The member leaves the Unconfirmed group as a confirmed address does. Every account a
    // provider makes has a verified address; only a repaired row may still wait for its link.
    return (!plan.confirms || identity.email_verified === 1) && promoteVerifiedMember(ctx, userId);
  });
  // As after a confirmation: an account that waits for staff is welcomed when it is approved.
  if (promoted && !isAwaiting(ctx, userId))
    queueAccountEmail(ctx, { kind: "welcome", userId, email: identity.email });
  return {
    username: ctx.sqlite
      .prepare<{ username: string }, [number]>("SELECT username FROM users WHERE id = ?1")
      .get(userId)!.username,
  };
}
