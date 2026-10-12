import { type Actor, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { ForbiddenError, NotFoundError } from "../../errors";
import { markPublic } from "../../operation";
import {
  currentVersions,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  requestVersions,
  requirePermission,
  resolvedPermissions,
} from "../../permissions";
import { getAuth } from "../auth";
import { ADMIN_PERMISSIONS } from "../auth/staff";
import { requireNotErased } from "./erased";
import { forgivePasswordGuess, takePasswordGuess } from "./password-guesses";

type Row = PrincipalRow & { id: number; group_id: number };
const TARGET_SQL = `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`;

/**
 * The member an administrator acts on, as an actor carrying their principal, for
 * `context.target` of a hierarchy-checked permission. NotFoundError when there is no such member.
 * Pass `fresh` inside a write transaction so the cache versions are read there.
 */
export const targetMember = markPublic(
  "Loads the member an administrator acts on; the caller decides what the actor may do to them.",
  (ctx: Ctx, actor: Actor, userId: number, fresh = false): Actor => {
    const row = prepared(ctx, "admin.target", () =>
      ctx.sqlite.prepare<Row, [number]>(TARGET_SQL),
    ).get(userId);
    if (!row) throw new NotFoundError();
    return memberActor(
      row.id,
      row.group_id,
      row,
      fresh ? currentVersions(ctx) : requestVersions(ctx, actor),
    );
  },
);

/**
 * Whether the actor holds a permission that is otherwise checked against a member (a list of
 * members or of bans has none). The resolved permissions apply no member-dependent condition.
 */
export function requireHeld(ctx: Ctx, actor: Actor, id: "admin.members" | "member.ban"): void {
  requireAuthenticated(actor);
  if (resolvedPermissions(ctx, actor)[id] !== true) throw new ForbiddenError();
}

/**
 * Setting a password or an address, or ending sessions, lets an administrator sign in as the
 * member. A member who holds any administration permission, through whatever source, is only
 * reachable by an actor who holds `admin.permissions` too: ranking above them is not enough.
 * `target` is the member as an actor (see `targetMember`). A ban does not count against the
 * member here: it can be lifted, and the account would be theirs again.
 */
export function requireTakeoverRights(ctx: Ctx, actor: Actor, target: Actor): void {
  const unbanned: Actor =
    target.kind !== "guest" && target.principal
      ? {
          ...target,
          principal: { ...target.principal, bannedUntil: null, bannedPermanently: false },
        }
      : target;
  const held = resolvedPermissions(ctx, unbanned);
  if (ADMIN_PERMISSIONS.some((id) => held[id] === true))
    requirePermission(ctx, actor, "admin.permissions");
}

/**
 * The acting administrator's own password, verified the way Better Auth verifies a sign-in. At
 * most five wrong answers in fifteen minutes: after that every answer is refused until the window
 * moves on. A right answer gives its guess back but does not clear the earlier wrong ones, so
 * guessing cannot be interleaved with right answers.
 */
export const verifyActorPassword = markPublic(
  "Checks the actor's own password; it grants nothing.",
  async (ctx: Ctx, actor: Actor, password: string): Promise<{ userId: number }> => {
    const user = requireAuthenticated(actor);
    if (actor.kind !== "user")
      throw new ForbiddenError("This needs a signed-in session; an API key cannot do it.");
    const guess = takePasswordGuess(ctx, user.userId);
    const authContext = await getAuth(ctx).$context;
    const account = await authContext.internalAdapter.findCredentialAccount(String(user.userId));
    if (!account?.password) {
      // Spend the same time as a wrong password would, so the answer does not tell the two apart.
      await authContext.password.hash(password);
      throw new ForbiddenError("That is not your password.");
    }
    if (!(await authContext.password.verify({ hash: account.password, password })))
      throw new ForbiddenError("That is not your password.");
    forgivePasswordGuess(ctx, guess);
    return { userId: user.userId };
  },
);

/**
 * The optional confirmation of a write that changes groups or permissions: when the request
 * carries the acting administrator's password it is verified first (same helper, same limit),
 * and a wrong one stops the request before anything is read or changed. Without it, nothing is
 * asked, which is how API clients call these operations.
 */
export const confirmActorPassword = markPublic(
  "Checks the actor's own password when one is sent; it grants nothing.",
  async (ctx: Ctx, actor: Actor, password: string | undefined): Promise<void> => {
    if (password !== undefined) await verifyActorPassword(ctx, actor, password);
  },
);

export { requireNotErased };
