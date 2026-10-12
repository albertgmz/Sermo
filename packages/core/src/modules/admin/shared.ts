import { type Actor, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { ForbiddenError, NotFoundError } from "../../errors";
import {
  currentVersions,
  memberActor,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  requestVersions,
  resolvedPermissions,
} from "../../permissions";
import { getAuth } from "../auth";

type Row = PrincipalRow & { id: number; group_id: number };
const TARGET_SQL = `SELECT u.id, u.group_id, ${PRINCIPAL_COLUMNS} FROM users u WHERE u.id = ?1`;

/**
 * The member an administrator acts on, as an actor carrying their principal, for
 * `context.target` of a hierarchy-checked permission. NotFoundError when there is no such member.
 * Pass `fresh` inside a write transaction so the cache versions are read there.
 */
export function targetMember(ctx: Ctx, actor: Actor, userId: number, fresh = false): Actor {
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
}

/**
 * Whether the actor holds admin.members at all. The permission is checked against a member where
 * one is acted on; a list or a read of a member's card has none, so the resolved permissions
 * (which apply no member-dependent condition) say whether it is held.
 */
export function requireMembersAdmin(ctx: Ctx, actor: Actor): void {
  requireAuthenticated(actor);
  if (resolvedPermissions(ctx, actor)["admin.members"] !== true) throw new ForbiddenError();
}

/**
 * Whether the actor holds a permission that is otherwise checked against a member (a list of
 * bans has none). The resolved permissions apply no member-dependent condition.
 */
export function requireHeld(ctx: Ctx, actor: Actor, id: "member.ban"): void {
  requireAuthenticated(actor);
  if (resolvedPermissions(ctx, actor)[id] !== true) throw new ForbiddenError();
}

/** The acting administrator's own password, verified the way Better Auth verifies a sign-in. */
export async function verifyActorPassword(
  ctx: Ctx,
  actor: Actor,
  password: string,
): Promise<{ userId: number }> {
  const user = requireAuthenticated(actor);
  if (actor.kind !== "user")
    throw new ForbiddenError("This needs a signed-in session; an API key cannot do it.");
  const authContext = await getAuth(ctx).$context;
  const account = await authContext.internalAdapter.findCredentialAccount(String(user.userId));
  if (!account?.password) {
    // Spend the same time as a wrong password would, so the answer does not tell the two apart.
    await authContext.password.hash(password);
    throw new ForbiddenError("That is not your password.");
  }
  if (!(await authContext.password.verify({ hash: account.password, password })))
    throw new ForbiddenError("That is not your password.");
  return { userId: user.userId };
}
