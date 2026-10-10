import { type apiKey, defaultKeyHasher } from "@better-auth/api-key";
import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { openAPI, type username } from "better-auth/plugins";
import { type Actor, GUEST, type Principal } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { authMe } from "../../contracts/auth";
import { authPlugins, authSchemaOptions, USERNAME_PATTERN } from "../../db/auth-options";
import * as schema from "../../db/auth-schema";
import { GROUP_IDS } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, UnauthenticatedError } from "../../errors";
import { publishEvent } from "../../events";
import { type AnyOperation, implement } from "../../operation";
import {
  combinationsGranting,
  memberDisplay,
  PRINCIPAL_COLUMNS,
  type PrincipalRow,
  permissionsOf,
  principalFromRow,
  resolvedPermissions,
} from "../../permissions";
import { iso } from "../../time";
import { accountEmailEnabled, queueAccountEmail } from "../email/account";

function verificationClaim(request: Request | undefined): { email?: string; updateTo?: string } {
  const token = request ? new URL(request.url).searchParams.get("token") : null;
  if (!token) return {};
  try {
    return JSON.parse(atob(token.split(".")[1]!)) as { email?: string; updateTo?: string };
  } catch {
    return {};
  }
}

function promoteVerifiedMember(ctx: Ctx, userId: number): boolean {
  return writeTx(ctx, () => {
    const changed =
      ctx.sqlite
        .prepare("UPDATE users SET group_id = ?1 WHERE id = ?2 AND group_id = ?3")
        .run(GROUP_IDS.member, userId, GROUP_IDS.unconfirmed).changes > 0;
    if (changed)
      publishEvent(ctx, {
        type: "member.groups_changed",
        targetType: "user",
        targetId: userId,
        payload: {
          added: [GROUP_IDS.member],
          removed: [GROUP_IDS.unconfirmed],
          source: "verification",
        },
      });
    return changed;
  });
}

function userConstraintError(error: unknown): APIError | null {
  if (!(error instanceof Error) || !/^UNIQUE constraint failed: users\./.test(error.message))
    return null;
  return /users\.username_key/.test(error.message)
    ? new APIError("BAD_REQUEST", {
        message: "Username is already taken.",
        code: "USERNAME_IS_ALREADY_TAKEN",
      })
    : new APIError("BAD_REQUEST", {
        message: "Forum profile already exists.",
        code: "USER_CONFLICT",
      });
}

function buildAuth(ctx: Ctx) {
  const config = ctx.config.auth;
  if (!config) throw new Error("Better Auth requires ctx.config.auth.");
  const plugins = authPlugins();
  const usernamePlugin = plugins.find((plugin) => plugin.id === "username") as
    | ReturnType<typeof username>
    | undefined;
  const apiKeyPlugin = plugins.find((plugin) => plugin.id === "api-key") as
    | ReturnType<typeof apiKey>
    | undefined;
  if (!usernamePlugin || !apiKeyPlugin)
    throw new Error("Better Auth username and API key plugins are required.");
  const mailEnabled = accountEmailEnabled(ctx);
  const emailChangeVerification = new WeakMap<Request, boolean>();
  return betterAuth({
    ...authSchemaOptions,
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(ctx.db, { provider: "sqlite", schema }),
    advanced: {
      ...authSchemaOptions.advanced,
      cookiePrefix: "sermo",
      ipAddress: { ipAddressHeaders: [config.clientIpHeader] },
      disableOriginCheck: false,
    },
    emailAndPassword: {
      enabled: true,
      revokeSessionsOnPasswordReset: true,
      ...(mailEnabled
        ? {
            sendResetPassword: async ({
              user,
              url,
            }: {
              user: { id: string; email: string };
              url: string;
            }) => {
              queueAccountEmail(ctx, {
                kind: "reset",
                userId: Number(user.id),
                email: user.email,
                url,
              });
            },
            onPasswordReset: async ({ user }: { user: { id: string; email: string } }) => {
              queueAccountEmail(ctx, {
                kind: "passwordChanged",
                userId: Number(user.id),
                email: user.email,
              });
            },
          }
        : {}),
      minPasswordLength: 8,
      maxPasswordLength: 256,
      password: {
        hash: (password) => Bun.password.hash(password, ctx.config.passwordHash),
        verify: ({ password, hash }) => Bun.password.verify(password, hash),
      },
    },
    session: {
      ...authSchemaOptions.session,
      expiresIn: ctx.config.sessionTtlMs / 1000,
      disableSessionRefresh: true,
      deferSessionRefresh: true,
      // Password resets revoke sessions in the database; cached session cookies would remain
      // usable until their signature expires, so use database-backed sessions with mail enabled.
      cookieCache: { enabled: !mailEnabled, maxAge: 300 },
    },
    rateLimit: {
      enabled: true,
      storage: "memory",
      customRules: {
        "/send-verification-email": { window: 3_600, max: 5 },
        "/request-password-reset": { window: 3_600, max: 5 },
        "/change-email": { window: 3_600, max: 5 },
      },
    },
    user: { ...authSchemaOptions.user, changeEmail: { enabled: mailEnabled } },
    ...(mailEnabled
      ? {
          emailVerification: {
            sendOnSignUp: true,
            sendVerificationEmail: async ({
              user,
              url,
            }: {
              user: { id: string; email: string };
              url: string;
            }) => {
              const claim = verificationClaim(new Request(url));
              queueAccountEmail(
                ctx,
                {
                  kind: claim.updateTo ? "changeEmail" : "verify",
                  userId: Number(user.id),
                  email: user.email,
                  url,
                },
                `email.account.verify.${url}`,
              );
            },
            afterEmailVerification: async (
              user: { id: string; email: string },
              request?: Request,
            ) => {
              const userId = Number(user.id);
              const claim = verificationClaim(request);
              const wasUnverified = request ? emailChangeVerification.get(request) === true : false;
              if (request) emailChangeVerification.delete(request);
              if (claim.updateTo && claim.email && claim.updateTo === user.email) {
                const promoted = wasUnverified && promoteVerifiedMember(ctx, userId);
                for (const email of new Set([claim.email, user.email]))
                  queueAccountEmail(ctx, { kind: "emailChanged", userId, email });
                if (promoted)
                  queueAccountEmail(ctx, { kind: "welcome", userId, email: user.email });
                return;
              }
              const promoted = promoteVerifiedMember(ctx, userId);
              if (promoted) queueAccountEmail(ctx, { kind: "welcome", userId, email: user.email });
            },
          },
        }
      : {}),
    hooks: {
      before: createAuthMiddleware(async (hook) => {
        if (!mailEnabled || hook.path !== "/verify-email" || !hook.request) return;
        const claim = verificationClaim(hook.request);
        if (!claim.updateTo || !claim.email) return;
        const old = ctx.sqlite
          .prepare<{ email_verified: number }, [string]>(
            "SELECT email_verified FROM auth_user WHERE email = ?1",
          )
          .get(claim.email);
        if (old) emailChangeVerification.set(hook.request, old.email_verified === 0);
      }),
      after: createAuthMiddleware(async (hook) => {
        if (hook.path === "/verify-email" && hook.request)
          emailChangeVerification.delete(hook.request);
        if (!mailEnabled) return;
        if (hook.context.returned instanceof APIError) return;
        if (hook.context.returned instanceof Response && !hook.context.returned.ok) return;
        if (hook.path === "/change-password") {
          const user = hook.context.session?.user;
          if (user)
            queueAccountEmail(ctx, {
              kind: "passwordChanged",
              userId: Number(user.id),
              email: user.email,
            });
        }
        if (hook.path === "/api-key/create") {
          const result = hook.context.returned as { id?: string; referenceId?: string } | undefined;
          const userId = Number(result?.referenceId);
          if (!result?.id || !Number.isSafeInteger(userId)) return;
          const user = ctx.sqlite
            .prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1")
            .get(userId);
          if (user)
            queueAccountEmail(
              ctx,
              { kind: "apiKeyCreated", userId, email: user.email },
              `email.account.key.${result.id}`,
            );
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user, hookContext) => {
            const username = typeof user.username === "string" ? user.username : null;
            if (!username)
              throw new APIError("BAD_REQUEST", {
                message: "Username is required.",
                code: "USERNAME_REQUIRED",
              });
            const display =
              typeof user.displayUsername === "string" ? user.displayUsername : username;
            if (!USERNAME_PATTERN.test(display) || display.toLowerCase() !== username.toLowerCase())
              throw new APIError("BAD_REQUEST", {
                message: "Display username must match username apart from letter case.",
                code: "INVALID_DISPLAY_USERNAME",
              });
            const existing = ctx.sqlite
              .prepare("SELECT id FROM users WHERE username_key = ?1")
              .get(username.toLowerCase());
            if (existing)
              throw new APIError("BAD_REQUEST", {
                message: "Username is already taken.",
                code: "USERNAME_IS_ALREADY_TAKEN",
              });
            if (ctx.config.spamChecker) {
              const headerName = ctx.config.auth?.clientIpHeader ?? "x-sermo-client-ip";
              const ip = (hookContext as { headers?: Headers } | undefined)?.headers?.get(
                headerName,
              );
              if (!ip)
                throw new APIError("BAD_REQUEST", {
                  message: "Client IP is required for spam checks.",
                  code: "SPAM_IP_REQUIRED",
                });
              const verdict = await ctx.config.spamChecker.check({
                ip,
                email: typeof user.email === "string" ? user.email : undefined,
                username,
                kind: "signup",
              });
              if (verdict.spam)
                throw new APIError("BAD_REQUEST", {
                  message: "Registration requires review.",
                  code: "SPAM_REJECTED",
                });
            }
          },
          after: async (user) => {
            const normalized = typeof user.username === "string" ? user.username : null;
            const display =
              typeof user.displayUsername === "string" ? user.displayUsername : normalized;
            if (!normalized || !display || display.toLowerCase() !== normalized)
              throw new APIError("BAD_REQUEST", {
                message: "Username is required.",
                code: "USERNAME_REQUIRED",
              });
            try {
              ctx.sqlite
                .prepare(
                  "INSERT INTO users (id, username, username_key, group_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                )
                .run(
                  Number(user.id),
                  display,
                  normalized,
                  mailEnabled ? GROUP_IDS.unconfirmed : GROUP_IDS.member,
                  ctx.now(),
                );
            } catch (error) {
              const mapped = userConstraintError(error);
              if (mapped) throw mapped;
              throw error;
            }
          },
        },
        update: {
          before: async (user, context) => {
            if ("username" in user && user.username === null)
              throw new APIError("BAD_REQUEST", {
                message: "Username cannot be cleared.",
                code: "USERNAME_REQUIRED",
              });
            if ("displayUsername" in user && user.displayUsername === null)
              throw new APIError("BAD_REQUEST", {
                message: "Display username cannot be cleared.",
                code: "INVALID_DISPLAY_USERNAME",
              });
            const typedUsername =
              typeof context?.body?.username === "string"
                ? context.body.username
                : typeof user.username === "string"
                  ? user.username
                  : null;
            const requested = typedUsername?.toLowerCase() ?? null;
            const display =
              typeof user.displayUsername === "string" ? user.displayUsername : typedUsername;
            if (!requested && !display) return;
            const currentId = Number(context?.context?.session?.user?.id);
            const current =
              Number.isSafeInteger(currentId) && currentId > 0
                ? ctx.sqlite
                    .prepare<{ username: string }, [number]>(
                      "SELECT username FROM auth_user WHERE id = ?1",
                    )
                    .get(currentId)
                : null;
            const normalized = requested ?? current?.username;
            if (
              !normalized ||
              (display && (!USERNAME_PATTERN.test(display) || display.toLowerCase() !== normalized))
            )
              throw new APIError("BAD_REQUEST", {
                message: "Display username must match username apart from letter case.",
                code: "INVALID_DISPLAY_USERNAME",
              });
            const existing = ctx.sqlite
              .prepare<{ id: number }, [string]>("SELECT id FROM users WHERE username_key = ?1")
              .get(normalized);
            if (existing && existing.id !== currentId)
              throw new APIError("BAD_REQUEST", {
                message: "Username is already taken.",
                code: "USERNAME_IS_ALREADY_TAKEN",
              });
            if (typedUsername && user.displayUsername === undefined)
              return { data: { ...user, displayUsername: typedUsername } };
          },
          after: async (user) => {
            const normalized = typeof user.username === "string" ? user.username : null;
            const display = typeof user.displayUsername === "string" ? user.displayUsername : null;
            if (!normalized) return;
            const username = display?.toLowerCase() === normalized ? display : normalized;
            try {
              ctx.sqlite
                .prepare("UPDATE users SET username = ?1, username_key = ?2 WHERE id = ?3")
                .run(username, normalized, Number(user.id));
            } catch (error) {
              const mapped = userConstraintError(error);
              if (mapped) throw mapped;
              throw error;
            }
          },
        },
      },
    },
    plugins: [usernamePlugin, apiKeyPlugin, openAPI()],
  });
}

export type SermoAuth = ReturnType<typeof buildAuth>;
const instances = new WeakMap<Ctx, { auth: SermoAuth; mailEnabled: boolean }>();

/** The Better Auth instance for this context. */
export function getAuth(ctx: Ctx): SermoAuth {
  const mailEnabled = accountEmailEnabled(ctx);
  let instance = instances.get(ctx);
  if (!instance || instance.mailEnabled !== mailEnabled) {
    instance = { auth: buildAuth(ctx), mailEnabled };
    instances.set(ctx, instance);
  }
  return instance.auth;
}

/** Revoke a banned user's Better Auth sessions and API keys through Better Auth's adapters. */
export async function revokeUserCredentials(ctx: Ctx, userId: number): Promise<void> {
  const authContext = await getAuth(ctx).$context;
  await authContext.internalAdapter.deleteUserSessions(String(userId));
  await authContext.adapter.deleteMany({
    model: "apikey",
    where: [{ field: "referenceId", value: String(userId) }],
  });
}

type ForumUser = { group_id: number };
type MemberRow = PrincipalRow & { pv: number | null; tv: number | null };
const MEMBER_SQL =
  `SELECT ${PRINCIPAL_COLUMNS}, ` +
  "(SELECT version FROM cache_versions WHERE key = 'permissions') AS pv, " +
  "(SELECT version FROM cache_versions WHERE key = 'node_tree') AS tv FROM users u WHERE u.id = ?1";

/**
 * The member's primary group (repairing a missing forum row), then their permission principal
 * (combination, ban and restriction state, cache versions) in one lookup. Refuses banned accounts.
 */
function memberFor(ctx: Ctx, userId: number): { groupId: number; principal: Principal } {
  const groupId = groupFor(ctx, userId);
  const row = prepared(ctx, "auth.member", () =>
    ctx.sqlite.prepare<MemberRow, [number]>(MEMBER_SQL),
  ).get(userId);
  if (!row) throw new UnauthenticatedError();
  if (row.banned_permanently || (row.banned_until !== null && row.banned_until > ctx.now()))
    throw new ForbiddenError("This account is banned.");
  // Buffered, never written during the request (see flushActivity).
  ctx.activity.set(userId, ctx.now());
  return {
    groupId,
    principal: principalFromRow(row, { permissions: row.pv ?? 0, nodeTree: row.tv ?? 0 }),
  };
}

function groupFor(ctx: Ctx, userId: number): number {
  const row = prepared(ctx, "auth.forumUser", () =>
    ctx.sqlite.prepare<ForumUser, [number]>("SELECT group_id FROM users WHERE id = ?1"),
  ).get(userId);
  if (row) return row.group_id;
  return writeTx(ctx, () => {
    const existing = prepared(ctx, "auth.forumUser", () =>
      ctx.sqlite.prepare<ForumUser, [number]>("SELECT group_id FROM users WHERE id = ?1"),
    ).get(userId);
    if (existing) return existing.group_id;
    const identity = prepared(ctx, "auth.identityForRepair", () =>
      ctx.sqlite.prepare<
        {
          username: string | null;
          display_username: string | null;
          name: string;
          created_at: number;
          email_verified: number;
        },
        [number]
      >(
        "SELECT username, display_username, name, created_at, email_verified FROM auth_user WHERE id = ?1",
      ),
    ).get(userId);
    if (!identity) throw new UnauthenticatedError();
    const normalized = identity.username;
    if (!normalized) throw new UnauthenticatedError();
    const username =
      identity.display_username?.toLowerCase() === normalized
        ? identity.display_username
        : normalized;
    const repairedGroup =
      accountEmailEnabled(ctx) && !identity.email_verified
        ? GROUP_IDS.unconfirmed
        : GROUP_IDS.member;
    ctx.sqlite
      .prepare(
        "INSERT INTO users (id, username, username_key, group_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .run(userId, username, normalized, repairedGroup, identity.created_at);
    return repairedGroup;
  });
}

/** Resolves API keys and session cookies to one actor for every caller. */
export async function resolveActor(
  ctx: Ctx,
  headers: Headers,
): Promise<{ actor: Actor; setCookies: string[] }> {
  const authorization = headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (authorization !== null && !bearer) throw new UnauthenticatedError();
  const key = bearer ?? headers.get("x-api-key");
  const clientIp = headers.get(ctx.config.auth?.clientIpHeader ?? "x-sermo-client-ip") ?? undefined;
  if (key !== null && key !== undefined) {
    const hash = await defaultKeyHasher(key);
    const row = prepared(ctx, "auth.apiKey", () =>
      ctx.sqlite.prepare<
        { id: number; reference_id: string; enabled: number | null; expires_at: number | null },
        [string]
      >("SELECT id, reference_id, enabled, expires_at FROM auth_apikey WHERE key = ?1"),
    ).get(hash);
    if (!row?.enabled || (row.expires_at !== null && row.expires_at <= Date.now()))
      throw new UnauthenticatedError();
    if (!/^\d+$/.test(row.reference_id)) throw new UnauthenticatedError();
    const userId = Number(row.reference_id);
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new UnauthenticatedError();
    const { groupId, principal } = memberFor(ctx, userId);
    return {
      actor: {
        kind: "token",
        userId,
        groupId,
        tokenId: row.id,
        principal,
        ...(clientIp ? { clientIp } : {}),
      },
      setCookies: [],
    };
  }
  const cookie = headers.get("cookie");
  if (!cookie || !/(?:^|;\s*)(?:__Secure-)?sermo\.session_token=/.test(cookie))
    return { actor: GUEST, setCookies: [] };
  const result = await getAuth(ctx).api.getSession({ headers, returnHeaders: true });
  const session = result.response;
  if (!session) throw new UnauthenticatedError();
  const userId = Number(session.user.id);
  const sessionId = Number(session.session.id);
  if (
    !Number.isSafeInteger(userId) ||
    userId <= 0 ||
    !Number.isSafeInteger(sessionId) ||
    sessionId <= 0
  )
    throw new UnauthenticatedError();
  const { groupId, principal } = memberFor(ctx, userId);
  return {
    actor: {
      kind: "user",
      userId,
      groupId,
      sessionId,
      principal,
      ...(clientIp ? { clientIp } : {}),
    },
    setCookies: result.headers.getSetCookie(),
  };
}

/** Removes expired Better Auth credentials. */
export function purgeExpiredCredentials(ctx: Ctx): {
  sessions: number;
  apiKeys: number;
  verifications: number;
} {
  return writeTx(ctx, () => {
    const now = ctx.now();
    return {
      sessions: ctx.sqlite.prepare("DELETE FROM auth_session WHERE expires_at <= ?1").run(now)
        .changes,
      apiKeys: ctx.sqlite
        .prepare("DELETE FROM auth_apikey WHERE expires_at IS NOT NULL AND expires_at <= ?1")
        .run(now).changes,
      verifications: ctx.sqlite
        .prepare("DELETE FROM auth_verification WHERE expires_at <= ?1")
        .run(now).changes,
    };
  });
}

/** Finds a member whose resolved permission combination grants administrator access. */
function administratorId(ctx: Ctx): number | null {
  const combinations = combinationsGranting(ctx, "admin.permissions");
  if (combinations.length === 0) return null;
  return (
    prepared(ctx, "auth.administrator", () =>
      ctx.sqlite.prepare<{ id: number }, [string]>(
        "SELECT id FROM users WHERE permission_combination_id IN (SELECT value FROM json_each(?1)) LIMIT 1",
      ),
    ).get(JSON.stringify(combinations))?.id ?? null
  );
}

/** Creates or promotes the first administrator, then remains idempotent. */
export async function ensureAdmin(
  ctx: Ctx,
  input: { username: string; email: string; password: string },
): Promise<{ userId: number; created: boolean }> {
  const admin = administratorId(ctx);
  if (admin !== null) return { userId: admin, created: false };
  const existing = ctx.sqlite
    .prepare<{ id: number; email: string }, [string]>(
      "SELECT id, email FROM auth_user WHERE username = ?1",
    )
    .get(input.username.toLowerCase());
  let created = false;
  let targetId: number;
  let verifiedHash: string | null = null;
  if (existing) {
    const account = ctx.sqlite
      .prepare<{ password: string | null }, [number]>(
        "SELECT password FROM auth_account WHERE user_id = ?1 AND provider_id = 'credential' LIMIT 1",
      )
      .get(existing.id);
    if (
      existing.email.toLowerCase() !== input.email.toLowerCase() ||
      !account?.password ||
      !(await Bun.password.verify(input.password, account.password))
    )
      throw new ConflictError("Admin bootstrap conflicts with an existing account.");
    verifiedHash = account.password;
    targetId = existing.id;
    groupFor(ctx, targetId);
  } else {
    const result = await getAuth(ctx).api.signUpEmail({
      body: {
        name: input.username,
        username: input.username,
        email: input.email,
        password: input.password,
      },
    });
    targetId = Number(result.user.id);
    created = true;
  }
  const userId = writeTx(ctx, () => {
    const current = administratorId(ctx);
    if (current !== null) return current;
    if (verifiedHash) {
      const identity = ctx.sqlite
        .prepare<{ email: string }, [number]>("SELECT email FROM auth_user WHERE id = ?1")
        .get(targetId);
      const account = ctx.sqlite
        .prepare<{ password: string | null }, [number]>(
          "SELECT password FROM auth_account WHERE user_id = ?1 AND provider_id = 'credential' LIMIT 1",
        )
        .get(targetId);
      if (
        identity?.email.toLowerCase() !== input.email.toLowerCase() ||
        account?.password !== verifiedHash
      )
        throw new ConflictError("Admin bootstrap conflicts with an existing account.");
    }
    const changed = ctx.sqlite
      .prepare("UPDATE users SET group_id = ?1 WHERE id = ?2")
      .run(GROUP_IDS.admin, targetId).changes;
    if (!changed) throw new ConflictError("Admin bootstrap account is missing its forum profile.");
    return targetId;
  });
  return { userId, created };
}

export const authMeOp = implement(authMe, (ctx, actor) => {
  const checks = permissionsOf(ctx, actor);
  const permissions = {
    isAdmin: checks.can("admin.permissions"),
    isModerator: checks.can("moderation.access"),
    canViewProfiles: checks.can("profile.view"),
    canPostProfile: checks.can("profilePost.post"),
    canStartConversations: checks.can("conversation.start"),
    canReact: checks.can("reaction.react"),
  };
  const resolved = resolvedPermissions(ctx, actor);
  if (actor.kind === "guest") return { user: null, permissions, resolvedPermissions: resolved };
  const row = prepared(ctx, "auth.me", () =>
    ctx.sqlite.prepare<
      { id: number; username: string; email: string; group_id: number; created_at: number },
      [number]
    >(
      "SELECT u.id, u.username, a.email, u.group_id, u.created_at FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1",
    ),
  ).get(actor.userId);
  if (!row) throw new UnauthenticatedError();
  // The actor's own principal: no further lookup.
  const display = memberDisplay(ctx, actor);
  return {
    user: {
      id: row.id,
      username: row.username,
      email: row.email,
      groupId: row.group_id,
      createdAt: iso(row.created_at),
      displayGroup: display && {
        id: display.groupId,
        title: display.title,
        userTitle: display.userTitle,
        badge: display.badge,
      },
    },
    permissions,
    resolvedPermissions: resolved,
  };
});

export const operations: AnyOperation[] = [authMeOp];
