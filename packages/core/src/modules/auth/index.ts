import { type apiKey, defaultKeyHasher } from "@better-auth/api-key";
import { APIError, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { openAPI, type username } from "better-auth/plugins";
import type { Actor } from "../../actor";
import { GUEST } from "../../actor";
import { type Ctx, prepared } from "../../context";
import { authMe } from "../../contracts/auth";
import { authPlugins, authSchemaOptions } from "../../db/auth-options";
import * as schema from "../../db/auth-schema";
import { GROUP_IDS } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { UnauthenticatedError } from "../../errors";
import { type AnyOperation, implement } from "../../operation";
import { iso } from "../../time";
import { getGlobalPermissions } from "../permissions";

function buildAuth(ctx: Ctx) {
  const config = ctx.config.auth;
  if (!config) throw new Error("Better Auth requires ctx.config.auth.");
  const plugins = authPlugins();
  return betterAuth({
    ...authSchemaOptions,
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: config.trustedOrigins,
    database: drizzleAdapter(ctx.db, { provider: "sqlite", schema }),
    advanced: {
      ...authSchemaOptions.advanced,
      cookiePrefix: "sermo",
      ipAddress: { ipAddressHeaders: config.ipAddressHeaders },
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
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-in/username": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 10 },
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (!user.username)
              throw new APIError("BAD_REQUEST", { message: "Username is required." });
          },
          after: async (user) => {
            const username =
              typeof user.displayUsername === "string" ? user.displayUsername : user.username;
            if (typeof username !== "string" || !username)
              throw new APIError("BAD_REQUEST", { message: "Username is required." });
            ctx.sqlite
              .prepare(
                "INSERT INTO users (id, username, username_key, group_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
              )
              .run(Number(user.id), username, username.toLowerCase(), GROUP_IDS.member, ctx.now());
          },
        },
        update: {
          after: async (user) => {
            const current = ctx.sqlite
              .prepare<{ username_key: string }, [number]>(
                "SELECT username_key FROM users WHERE id = ?1",
              )
              .get(Number(user.id));
            const normalized = typeof user.username === "string" ? user.username : null;
            const display = typeof user.displayUsername === "string" ? user.displayUsername : null;
            let username = display ?? normalized;
            if (
              normalized &&
              current?.username_key !== normalized &&
              display?.toLowerCase() !== normalized
            )
              username = normalized;
            if (username)
              ctx.sqlite
                .prepare("UPDATE users SET username = ?1, username_key = ?2 WHERE id = ?3")
                .run(username, username.toLowerCase(), Number(user.id));
          },
        },
      },
    },
    plugins: [
      plugins[0] as ReturnType<typeof username>,
      plugins[1] as ReturnType<typeof apiKey>,
      openAPI(),
    ],
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

type ForumUser = { group_id: number };
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
    const username = identity.display_username ?? identity.username ?? identity.name;
    ctx.sqlite
      .prepare(
        "INSERT INTO users (id, username, username_key, group_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
      )
      .run(userId, username, username.toLowerCase(), GROUP_IDS.member, identity.created_at);
    return GROUP_IDS.member;
  });
}

/** Resolves API keys and session cookies to one actor for every caller. */
export async function resolveActor(ctx: Ctx, headers: Headers): Promise<Actor> {
  const authorization = headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const key = bearer ?? headers.get("x-api-key");
  if (authorization?.toLowerCase().startsWith("bearer") && !bearer)
    throw new UnauthenticatedError();
  if (key !== null && key !== undefined) {
    const hash = await defaultKeyHasher(key);
    const row = prepared(ctx, "auth.apiKey", () =>
      ctx.sqlite.prepare<
        { id: number; reference_id: string; enabled: number | null; expires_at: number | null },
        [string]
      >("SELECT id, reference_id, enabled, expires_at FROM auth_apikey WHERE key = ?1"),
    ).get(hash);
    if (!row?.enabled || (row.expires_at !== null && row.expires_at <= ctx.now()))
      throw new UnauthenticatedError();
    const userId = Number(row.reference_id);
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new UnauthenticatedError();
    return { kind: "token", userId, groupId: groupFor(ctx, userId), tokenId: row.id };
  }
  const cookie = headers.get("cookie");
  if (!cookie || !/(?:^|;\s*)(?:__Secure-)?sermo\.session_token=/.test(cookie)) return GUEST;
  const session = await getAuth(ctx).api.getSession({ headers });
  if (!session) throw new UnauthenticatedError();
  const userId = Number(session.user.id);
  return {
    kind: "user",
    userId,
    groupId: groupFor(ctx, userId),
    sessionId: Number(session.session.id),
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
  let row = ctx.sqlite
    .prepare<{ id: number }, [string]>("SELECT id FROM users WHERE username_key = ?1")
    .get(input.username.toLowerCase());
  if (!row) {
    const identity = ctx.sqlite
      .prepare<{ id: number }, [string]>("SELECT id FROM auth_user WHERE username = ?1")
      .get(input.username.toLowerCase());
    if (identity) {
      groupFor(ctx, identity.id);
      row = identity;
    }
  }
  let created = false;
  if (!row) {
    const result = await getAuth(ctx).api.signUpEmail({
      body: {
        name: input.username,
        username: input.username,
        email: input.email,
        password: input.password,
      },
    });
    row = { id: Number(result.user.id) };
    created = true;
  }
  const targetId = row.id;
  writeTx(ctx, () => {
    const current = ctx.sqlite
      .prepare<{ id: number }, []>(
        "SELECT u.id FROM users u JOIN groups g ON g.id = u.group_id WHERE g.is_admin = 1 LIMIT 1",
      )
      .get();
    if (!current)
      ctx.sqlite
        .prepare("UPDATE users SET group_id = ?1 WHERE id = ?2")
        .run(GROUP_IDS.admin, targetId);
    else row = current;
  });
  return { userId: row.id, created };
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
