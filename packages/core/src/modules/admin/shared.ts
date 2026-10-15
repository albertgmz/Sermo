import { type Actor, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { ForbiddenError, NotFoundError, ValidationError } from "../../errors";
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
import { checkOwnPassword } from "./password-guesses";

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

const KEY_REFUSED = "This needs a signed-in session; an API key cannot do it.";

/**
 * The acting administrator's own password, verified the way Better Auth verifies a sign-in. At
 * most five wrong answers per session and twenty per member in fifteen minutes: after that every
 * answer is refused until the window moves on. A right answer gives its guess back but does not
 * clear the earlier wrong ones, so guessing cannot be interleaved with right answers.
 */
export const verifyActorPassword = markPublic(
  "Checks the actor's own password; it grants nothing.",
  async (
    ctx: Ctx,
    actor: Actor,
    password: string,
    field = "actorPassword",
  ): Promise<{ userId: number }> => {
    const user = requireAuthenticated(actor);
    if (actor.kind !== "user") throw new ForbiddenError(KEY_REFUSED);
    await checkOwnPassword(
      ctx,
      await getAuth(ctx).$context,
      user.userId,
      actor.sessionId,
      password,
      field,
    );
    return { userId: user.userId };
  },
);

/**
 * The confirmation of a write that changes groups, permissions or promotion rules. An API key is
 * refused whether or not it sends a password: these changes need a signed-in session. A password
 * that is sent is verified (same helper, same limit) and a wrong one stops the request
 * before anything is changed. An interactive session (a browser session cookie, marked by the
 * HTTP layer on every session actor it resolves, for REST and MCP alike) must send one.
 * In-process callers (loaders, jobs, tests build their actors by hand, never carry the mark and
 * are never a key) are not asked. Called after the early permission check, so someone who may
 * not act is told so whatever they send.
 */
export const confirmActorPassword = markPublic(
  "Checks the actor's own password when one is sent or required; it grants nothing.",
  async (ctx: Ctx, actor: Actor, password: string | undefined): Promise<void> => {
    if (actor.kind === "token") throw new ForbiddenError(KEY_REFUSED);
    if (password !== undefined) return void (await verifyActorPassword(ctx, actor, password));
    if (actor.kind === "user" && actor.interactive)
      throw new ValidationError("The acting administrator's password is required.", [
        { path: ["actorPassword"], message: "Required" },
      ]);
  },
);

export { requireNotErased };
