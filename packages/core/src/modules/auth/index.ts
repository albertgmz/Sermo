import { type apiKey, defaultKeyHasher } from "@better-auth/api-key";
import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { openAPI, type username } from "better-auth/plugins";
import { type Actor, GUEST, type Principal } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { authMe } from "../../contracts/auth";
import { authPlugins, authSchemaOptions, USERNAME_PATTERN } from "../../db/auth-options";
import * as schema from "../../db/auth-schema";
import { GROUP_IDS } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, UnauthenticatedError } from "../../errors";
import { type AnyOperation, implement } from "../../operation";
import { PRINCIPAL_COLUMNS, type PrincipalRow, principalFromRow } from "../../permissions";
import { iso } from "../../time";
import { getGlobalPermissions } from "../permissions";

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
      cookieCache: { enabled: true, maxAge: 300 },
    },
    rateLimit: {
      enabled: true,
      storage: "memory",
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
                .run(Number(user.id), display, normalized, GROUP_IDS.member, ctx.now());
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
const instances = new WeakMap<Ctx, SermoAuth>();

/** The Better Auth instance for this context. */
export function getAuth(ctx: Ctx): SermoAuth {
  let auth = instances.get(ctx);
  if (!auth) {
    auth = buildAuth(ctx);
    instances.set(ctx, auth);
  }
  return auth;
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
        },
        [number]
      >("SELECT username, display_username, name, created_at FROM auth_user WHERE id = ?1"),
    ).get(userId);
    if (!identity) throw new UnauthenticatedError();
    const normalized = identity.username;
    if (!normalized) throw new UnauthenticatedError();
    const username =
      identity.display_username?.toLowerCase() === normalized
        ? identity.display_username
        : normalized;
    ctx.sqlite
      .prepare(
        "INSERT INTO users (id, username, username_key, group_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .run(userId, username, normalized, GROUP_IDS.member, identity.created_at);
    return GROUP_IDS.member;
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

/** Creates or promotes the first administrator, then remains idempotent. */
export async function ensureAdmin(
  ctx: Ctx,
  input: { username: string; email: string; password: string },
): Promise<{ userId: number; created: boolean }> {
  const admin = ctx.sqlite
    .prepare<{ id: number }, []>(
      "SELECT u.id FROM users u JOIN groups g ON g.id = u.group_id WHERE g.is_admin = 1 LIMIT 1",
    )
    .get();
  if (admin) return { userId: admin.id, created: false };
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
    const current = ctx.sqlite
      .prepare<{ id: number }, []>(
        "SELECT u.id FROM users u JOIN groups g ON g.id = u.group_id WHERE g.is_admin = 1 LIMIT 1",
      )
      .get();
    if (current) return current.id;
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
  const permissions = getGlobalPermissions(ctx, actor);
  if (actor.kind === "guest") return { user: null, permissions };
  const row = prepared(ctx, "auth.me", () =>
    ctx.sqlite.prepare<
      { id: number; username: string; email: string; group_id: number; created_at: number },
      [number]
    >(
      "SELECT u.id, u.username, a.email, u.group_id, u.created_at FROM users u JOIN auth_user a ON a.id = u.id WHERE u.id = ?1",
    ),
  ).get(actor.userId);
  if (!row) throw new UnauthenticatedError();
  return {
    user: {
      id: row.id,
      username: row.username,
      email: row.email,
      groupId: row.group_id,
      createdAt: iso(row.created_at),
    },
    permissions,
  };
});

export const operations: AnyOperation[] = [authMeOp];
