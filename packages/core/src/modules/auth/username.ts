import { APIError } from "better-auth";
import { requireAuthenticated } from "../../actor";
import type { Ctx } from "../../context";
import { usersChangeUsername } from "../../contracts/members";
import { isReservedUsername, isValidUsername } from "../../db/auth-options";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { can, currentActor, requirePermission } from "../../permissions";
import { getAuth } from "./index";
import { renameStanding } from "./rename-limit";
import { asUsernameChange } from "./rename-marker";

/** Better Auth's username bounds (see authPlugins). */
const MIN_LENGTH = 3;
const MAX_LENGTH = 32;

const TAKEN_SQL = "SELECT id FROM users WHERE username_key = ?1";
const UNITS_SQL =
  "SELECT COALESCE(SUM(inv.quantity), 0) AS n FROM shop_inventory inv JOIN shop_items it ON it.id = inv.item_id WHERE inv.user_id = ?1 AND inv.state = 'unused' AND json_extract(it.effect, '$.type') = 'usernameChange'";
// One unit of the member's oldest row, taken by a conditional update: two requests cannot spend
// the same unit, and the last unit moves its row to `used`.
const TAKE_SQL =
  "UPDATE shop_inventory SET quantity = quantity - 1, state = CASE WHEN quantity = 1 THEN 'used' ELSE 'unused' END, updated_at = ?2 WHERE state = 'unused' AND quantity > 0 AND id = (SELECT inv.id FROM shop_inventory inv JOIN shop_items it ON it.id = inv.item_id WHERE inv.user_id = ?1 AND inv.state = 'unused' AND inv.quantity > 0 AND json_extract(it.effect, '$.type') = 'usernameChange' ORDER BY inv.acquired_at, inv.id LIMIT 1) RETURNING id";

function giveBack(ctx: Ctx, inventoryId: number): void {
  writeTx(ctx, () => {
    ctx.sqlite
      .prepare(
        "UPDATE shop_inventory SET quantity = quantity + 1, state = 'unused', updated_at = ?1 WHERE id = ?2",
      )
      .run(ctx.now(), inventoryId);
  });
}

/** What a refused rename says: the permission that refused it, and when a limit frees a change. */
function refuseRename(standing: ReturnType<typeof renameStanding>): never {
  if (standing.reason === "approval")
    throw new ForbiddenError("Your username can only be changed by staff. Ask a staff member.");
  throw new ForbiddenError(
    standing.availableAt === null
      ? "You have used all the username changes you are allowed."
      : `You have used your username changes for now. You can change it again on ${new Date(standing.availableAt).toISOString()}.`,
  );
}

/**
 * The registration rules for a username: Better Auth's length bounds, the pattern, and the same
 * pattern after lowercasing (the stored key). A name kept for erased accounts is refused as taken,
 * so the rule is not advertised. Returns the stored key.
 */
export function checkUsername(name: string): string {
  if (name.length < MIN_LENGTH || name.length > MAX_LENGTH || !isValidUsername(name))
    throw new ValidationError(
      `A username is ${MIN_LENGTH} to ${MAX_LENGTH} letters, numbers, spaces, dots, dashes or underscores, and starts and ends with a letter or number.`,
    );
  if (isReservedUsername(name)) throw new ConflictError("That username is taken.");
  return name.toLowerCase();
}

/**
 * Changes a member's username through Better Auth (never by writing its tables), under the
 * rename marker its update hook requires. Only the display form changes when the name differs
 * in case alone: Better Auth then has no other holder of the name to tell apart from the member.
 * Better Auth's `name` follows the username, as it was given the username at registration.
 * `reserved` allows a name kept for erased accounts (an erasure, or putting back a name a member
 * already had). Refusals come back as the forum's own errors.
 */
export async function renameThroughAuth(
  ctx: Ctx,
  userId: number,
  name: string,
  currentKey: string,
  options: { reserved?: boolean } = {},
): Promise<void> {
  const key = name.toLowerCase();
  const authContext = await getAuth(ctx).$context;
  try {
    await asUsernameChange(
      userId,
      () =>
        authContext.internalAdapter.updateUser(
          String(userId),
          key === currentKey
            ? { displayUsername: name, name }
            : { username: key, displayUsername: name, name },
        ),
      options.reserved === true,
    );
  } catch (error) {
    throw refusal(error);
  }
}

/**
 * Puts Better Auth's name for the member back to the forum's, after a change that failed part
 * way (the provider may have accepted the name before the forum's own update failed). False when
 * the names still differ.
 */
async function restoreName(
  ctx: Ctx,
  userId: number,
  own: { username: string; username_key: string },
): Promise<boolean> {
  const provider = ctx.sqlite
    .prepare<{ username: string | null; display_username: string | null }, [number]>(
      "SELECT username, display_username FROM auth_user WHERE id = ?1",
    )
    .get(userId);
  if (
    !provider ||
    (provider.username === own.username_key && provider.display_username === own.username)
  )
    return true;
  try {
    await renameThroughAuth(ctx, userId, own.username, provider.username ?? "", {
      reserved: true,
    });
    return true;
  } catch (error) {
    console.error("[users.renameInconsistent]", { userId, expected: own.username }, error);
    return false;
  }
}

/** What Better Auth refused, as the forum's own errors. */
function refusal(error: unknown): unknown {
  if (!(error instanceof APIError)) return error;
  const code = (error.body as { code?: string } | undefined)?.code;
  const message = (error.body as { message?: string } | undefined)?.message ?? error.message;
  return code === "USERNAME_IS_ALREADY_TAKEN"
    ? new ConflictError("That username is taken.")
    : new ValidationError(message);
}

export const usersChangeUsernameOp = implement(usersChangeUsername, async (ctx, actor, input) => {
  const user = requireAuthenticated(actor);
  requirePermission(ctx, actor, "profile.editOwn");
  const early = renameStanding(ctx, actor, user.userId);
  if (early.reason) refuseRename(early);
  const name = input.username;
  const key = checkUsername(name);
  const own = ctx.sqlite
    .prepare<{ username: string; username_key: string }, [number]>(
      "SELECT username, username_key FROM users WHERE id = ?1",
    )
    .get(user.userId);
  if (!own) throw new ConflictError("This account has no forum profile.");
  const holder = ctx.sqlite.prepare<{ id: number }, [string]>(TAKEN_SQL).get(key);
  if (holder && holder.id !== user.userId) throw new ConflictError("That username is taken.");
  if (own.username === name) throw new ValidationError("That is already your username.");

  // Entitlement first: a free change costs nothing, otherwise one unit is taken now and given
  // back if the change then fails. A crash between the two steps loses the unit without a
  // rename; that is accepted.
  const spent = writeTx(ctx, () => {
    const current = currentActor(ctx, actor);
    requirePermission(ctx, current, "profile.editOwn");
    // Counted here, in the transaction that records the change, so two requests cannot both pass.
    const standing = renameStanding(ctx, current, user.userId);
    if (standing.reason) refuseRename(standing);
    let unit: number | null = null;
    if (!can(ctx, current, "profile.renameFree")) {
      requirePermission(ctx, current, "shop.buy");
      const taken = ctx.sqlite
        .prepare<{ id: number }, [number, number]>(TAKE_SQL)
        .get(user.userId, ctx.now());
      if (!taken) throw new ConflictError("You have no username change to spend.");
      unit = taken.id;
    }
    const change = ctx.sqlite
      .prepare<{ id: number }, [number, number]>(
        "INSERT INTO username_changes (user_id, changed_at) VALUES (?1, ?2) RETURNING id",
      )
      .get(user.userId, ctx.now())!;
    return { unit, change: change.id };
  });

  try {
    await renameThroughAuth(ctx, user.userId, name, own.username_key);
    return writeTx(ctx, () => {
      ctx.sqlite
        .prepare("UPDATE users SET content_updated_at = ?1, username_changed_at = ?1 WHERE id = ?2")
        .run(ctx.now(), user.userId);
      publishEvent(ctx, { type: "content.edited", targetType: "profile", targetId: user.userId });
      return {
        username: ctx.sqlite
          .prepare<{ username: string }, [number]>("SELECT username FROM users WHERE id = ?1")
          .get(user.userId)!.username,
        remaining:
          spent.unit === null
            ? null
            : ctx.sqlite.prepare<{ n: number }, [number]>(UNITS_SQL).get(user.userId)!.n,
      };
    });
  } catch (error) {
    // The unit comes back only when the member ends up with the name they had: if Better Auth
    // keeps the new one and the forum the old, the unit stays spent and the mismatch is logged.
    if (await restoreName(ctx, user.userId, own)) {
      if (spent.unit !== null) giveBack(ctx, spent.unit);
      writeTx(ctx, () => {
        ctx.sqlite.prepare("DELETE FROM username_changes WHERE id = ?1").run(spent.change);
      });
    }
    throw error;
  }
});
