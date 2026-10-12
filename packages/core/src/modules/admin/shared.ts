import { type Actor, requireAuthenticated } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError, RateLimitedError } from "../../errors";
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

/** An erased account takes no administrative change; reading it is allowed. */
export function requireNotErased(ctx: Ctx, userId: number): void {
  const row = prepared(ctx, "admin.erasedAt", () =>
    ctx.sqlite.prepare<{ erased_at: number | null }, [number]>(
      "SELECT erased_at FROM users WHERE id = ?1",
    ),
  ).get(userId);
  if (row?.erased_at != null) throw new ConflictError("This member's account was erased.");
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

/** Wrong answers one administrator may give, and the window they count in. */
export const WRONG_PASSWORD_LIMIT = 5;
export const WRONG_PASSWORD_WINDOW_MS = 15 * 60_000;

export const passwordGuessSql = {
  recent:
    "SELECT count(*) AS n FROM (SELECT 1 FROM admin_password_failures WHERE user_id = ?1 AND at > ?2 LIMIT ?3)",
  prune: "DELETE FROM admin_password_failures WHERE user_id = ?1 AND at <= ?2",
  add: "INSERT INTO admin_password_failures (user_id, at) VALUES (?1, ?2) RETURNING id",
  forgive: "DELETE FROM admin_password_failures WHERE id = ?1",
};

/**
 * Takes one of the member's guesses for the window, or refuses when they are used up. A guess is
 * recorded before the password is checked, so answers sent in parallel are counted as well.
 */
function takeGuess(ctx: Ctx, userId: number): number {
  return writeTx(ctx, () => {
    const now = ctx.now();
    const since = now - WRONG_PASSWORD_WINDOW_MS;
    ctx.sqlite.prepare(passwordGuessSql.prune).run(userId, since);
    const used = prepared(ctx, "admin.guessCount", () =>
      ctx.sqlite.prepare<{ n: number }, [number, number, number]>(passwordGuessSql.recent),
    ).get(userId, since, WRONG_PASSWORD_LIMIT)!.n;
    if (used >= WRONG_PASSWORD_LIMIT)
      throw new RateLimitedError("Too many wrong passwords. Try again later.");
    return ctx.sqlite
      .prepare<{ id: number }, [number, number]>(passwordGuessSql.add)
      .get(userId, now)!.id;
  });
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
    const guess = takeGuess(ctx, user.userId);
    const authContext = await getAuth(ctx).$context;
    const account = await authContext.internalAdapter.findCredentialAccount(String(user.userId));
    if (!account?.password) {
      // Spend the same time as a wrong password would, so the answer does not tell the two apart.
      await authContext.password.hash(password);
      throw new ForbiddenError("That is not your password.");
    }
    if (!(await authContext.password.verify({ hash: account.password, password })))
      throw new ForbiddenError("That is not your password.");
    writeTx(ctx, () => ctx.sqlite.prepare(passwordGuessSql.forgive).run(guess));
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
