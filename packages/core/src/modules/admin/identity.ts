import { requireAuthenticated } from "../../actor";
import { prepared } from "../../context";
import { authVerifyPassword, usersAdminUpdateIdentity } from "../../contracts/admin";
import { GROUP_IDS } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError, ValidationError } from "../../errors";
import { publishEvent } from "../../events";
import { implement } from "../../operation";
import { currentActor, requirePermission } from "../../permissions";
import {
  deletePendingTokens,
  getAuth,
  markSessionsRevoked,
  promoteVerifiedMember,
  revokeApiKeys,
} from "../auth";
import { checkUsername, renameThroughAuth } from "../auth/username";
import { accountEmailEnabled } from "../email/account";
import { appendModeratorLog } from "../moderation";
import { loadAdminMember } from "./members";
import {
  requireNotErased,
  requireTakeoverRights,
  targetMember,
  verifyActorPassword,
} from "./shared";

export const authVerifyPasswordOp = implement(
  authVerifyPassword,
  async (ctx, actor, input) => {
    await verifyActorPassword(ctx, actor, input.password, "password");
    return { ok: true as const };
  },
  { public: "A signed-in member checks only their own password; nothing is read or changed." },
);

interface IdentityRow {
  username: string;
  username_key: string;
  group_id: number;
  email: string;
  email_verified: number;
}
export const identitySql = {
  member:
    "SELECT u.username, u.username_key, u.group_id, a.email, a.email_verified FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1",
  usernameHolder: "SELECT id FROM users WHERE username_key = ?1",
  emailHolder: "SELECT id FROM auth_user WHERE email = ?1 AND id <> ?2",
};

/** Better Auth's or the database's refusal of an address already in use, as the forum's error. */
function addressRefusal(error: unknown): unknown {
  const text = error instanceof Error ? `${error.message} ${JSON.stringify(error)}` : "";
  return /UNIQUE|already|in use/i.test(text) && /email/i.test(text)
    ? new ConflictError("That email address is already in use.")
    : error;
}

export const usersAdminUpdateIdentityOp = implement(
  usersAdminUpdateIdentity,
  async (ctx, actor, input) => {
    requireAuthenticated(actor);
    if (input.password !== undefined && input.sendPasswordReset)
      throw new ValidationError("Set a password or send a reset link, not both.");
    // Their own password first, then who they act on.
    await verifyActorPassword(ctx, actor, input.actorPassword);
    const target = targetMember(ctx, actor, input.userId);
    requirePermission(ctx, actor, "admin.members", { target });
    requireTakeoverRights(ctx, actor, target);
    requireNotErased(ctx, input.userId);
    const own = prepared(ctx, "admin.identity", () =>
      ctx.sqlite.prepare<IdentityRow, [number]>(identitySql.member),
    ).get(input.userId);
    if (!own) throw new ConflictError("This account has no forum profile.");

    // Everything that can be refused is checked before anything changes.
    const plan: {
      username?: { name: string; key: string };
      email?: string;
      emailVerified?: boolean;
      passwordHash?: string;
      reset?: true;
    } = {};
    if (input.username !== undefined) {
      const key = checkUsername(input.username);
      const holder = prepared(ctx, "admin.usernameHolder", () =>
        ctx.sqlite.prepare<{ id: number }, [string]>(identitySql.usernameHolder),
      ).get(key);
      if (holder && holder.id !== input.userId) throw new ConflictError("That username is taken.");
      if (own.username === input.username)
        throw new ValidationError("That is already their username.");
      plan.username = { name: input.username, key };
    }
    const email = input.email?.toLowerCase();
    if (email !== undefined && email !== own.email) {
      const holder = prepared(ctx, "admin.emailHolder", () =>
        ctx.sqlite.prepare<{ id: number }, [string, number]>(identitySql.emailHolder),
      ).get(email, input.userId);
      if (holder) throw new ConflictError("That email address is already in use.");
      plan.email = email;
    }
    if (input.emailVerified !== undefined && input.emailVerified !== !!own.email_verified)
      plan.emailVerified = input.emailVerified;
    if (input.password !== undefined)
      plan.passwordHash = await (await getAuth(ctx).$context).password.hash(input.password);
    if (input.sendPasswordReset) {
      if (!accountEmailEnabled(ctx))
        throw new ConflictError("Mail is not configured, so no reset link can be sent.");
      plan.reset = true;
    }
    if (Object.keys(plan).length === 0) throw new ValidationError("Nothing to change.");

    // The log first, in the transaction that re-checks the actor against what is committed now:
    // a change that was made is always in the log, and an administrator who lost the permission
    // meanwhile changes nothing. Better Auth's own writes cannot join this transaction.
    writeTx(ctx, () => {
      const current = currentActor(ctx, actor);
      const fresh = targetMember(ctx, current, input.userId, true);
      requirePermission(ctx, current, "admin.members", { target: fresh });
      requireTakeoverRights(ctx, current, fresh);
      requireNotErased(ctx, input.userId);
      const log = (action: string, details: Record<string, unknown> = {}) =>
        appendModeratorLog(ctx, actor, action, "user", input.userId, "", details);
      if (plan.username) log("member.username", { from: own.username, to: plan.username.name });
      if (plan.email !== undefined || plan.emailVerified !== undefined)
        log("member.email", {
          // That it changed, never any part of the address.
          ...(plan.email !== undefined ? { changed: true } : {}),
          ...(plan.emailVerified !== undefined ? { verified: plan.emailVerified } : {}),
        });
      if (plan.passwordHash) {
        log("member.password");
        markSessionsRevoked(ctx, input.userId);
      }
      if (plan.reset) log("member.passwordReset");
    });

    const userId = String(input.userId);
    let step = "";
    try {
      const authContext = await getAuth(ctx).$context;
      if (plan.email !== undefined || plan.emailVerified !== undefined) {
        step = "email";
        await authContext.internalAdapter.updateUser(userId, {
          ...(plan.email !== undefined ? { email: plan.email } : {}),
          ...(plan.emailVerified !== undefined ? { emailVerified: plan.emailVerified } : {}),
        });
        // A reset or change-email link requested for the old address must not outlive it.
        if (plan.email !== undefined) await deletePendingTokens(ctx, input.userId);
        if (plan.emailVerified === true && own.group_id === GROUP_IDS.unconfirmed)
          promoteVerifiedMember(ctx, input.userId);
      }
      if (plan.username) {
        step = "username";
        await renameThroughAuth(ctx, input.userId, plan.username.name, own.username_key);
        writeTx(ctx, () => {
          ctx.sqlite
            .prepare(
              "UPDATE users SET content_updated_at = ?1, username_changed_at = ?1 WHERE id = ?2",
            )
            .run(ctx.now(), input.userId);
          publishEvent(ctx, {
            type: "content.edited",
            targetType: "profile",
            targetId: input.userId,
          });
        });
      }
      if (plan.passwordHash) {
        step = "password";
        if (await authContext.internalAdapter.findCredentialAccount(userId))
          await authContext.internalAdapter.updatePassword(userId, plan.passwordHash);
        else
          await authContext.internalAdapter.createAccount({
            userId,
            providerId: "credential",
            accountId: userId,
            password: plan.passwordHash,
          });
        // A new password signs the member out everywhere, as a reset does, and no earlier link
        // may set another one.
        await authContext.internalAdapter.deleteUserSessions(userId);
        writeTx(ctx, () => markSessionsRevoked(ctx, input.userId));
        // API keys are credentials: a key made with the old password stops working too.
        await revokeApiKeys(ctx, input.userId);
        await deletePendingTokens(ctx, input.userId);
      }
      if (plan.reset) {
        step = "reset";
        await getAuth(ctx).api.requestPasswordReset({
          body: {
            email: plan.email ?? own.email,
            redirectTo: `${ctx.config.siteBaseURL ?? ctx.config.auth?.baseURL ?? "http://localhost:3000"}/reset-password`,
          },
        });
      }
    } catch (error) {
      writeTx(ctx, () => {
        appendModeratorLog(ctx, actor, "member.identity.failed", "user", input.userId, "", {
          step,
        });
      });
      throw addressRefusal(error);
    }
    return loadAdminMember(ctx, actor, input.userId);
  },
);
