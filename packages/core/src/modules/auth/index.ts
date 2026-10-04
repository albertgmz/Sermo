import type { Actor } from "../../actor";
import { type Ctx, invalidate, prepared } from "../../context";
import {
  authCreateToken,
  authListTokens,
  authLogin,
  authLogout,
  authMe,
  authRegister,
  authRevokeToken,
} from "../../contracts/auth";
import { GROUP_IDS } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { ConflictError, ForbiddenError, NotFoundError, UnauthenticatedError } from "../../errors";
import { implement } from "../../operation";
import { iso, isoOrNull } from "../../time";
import { getGlobalPermissions } from "../permissions";

type UserRow = {
  id: number;
  username: string;
  email: string;
  group_id: number;
  created_at: number;
  password_hash: string;
};
type CredentialRow = { id: number; user_id: number; group_id: number };
type TokenRow = { id: number; name: string; created_at: number; expires_at: number | null };
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$XqiDiQuATbWmrhh51O/EXqSStQiwsID1xZOOXkyE/sM$qMOYvqqdv3r3AuUoWGEwwqCpITkFcKybcZ1IcYeHaok";
const DAY = 86_400_000;
const self = (row: UserRow) => ({
  id: row.id,
  username: row.username,
  email: row.email,
  groupId: row.group_id,
  createdAt: iso(row.created_at),
});
const tokenValue = (row: TokenRow) => ({
  id: row.id,
  name: row.name,
  createdAt: iso(row.created_at),
  expiresAt: isoOrNull(row.expires_at),
});
function newToken(prefix: "sess_" | "sermo_"): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return prefix + Buffer.from(bytes).toString("base64url");
}
function hashToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("hex");
}
function session(ctx: Ctx, userId: number) {
  const token = newToken("sess_");
  const expiresAt = ctx.now() + ctx.config.sessionTtlMs;
  ctx.sqlite
    .prepare(
      "INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)",
    )
    .run(userId, hashToken(token), ctx.now(), expiresAt);
  return { token, expiresAt: iso(expiresAt) };
}
function requireSession(actor: Actor): Extract<Actor, { kind: "user" }> {
  if (actor.kind === "guest") throw new UnauthenticatedError();
  if (actor.kind === "token") throw new ForbiddenError();
  return actor;
}
function userById(ctx: Ctx, id: number): UserRow | null {
  return (
    prepared(ctx, "auth.userById", () =>
      ctx.sqlite.prepare<UserRow, [number]>(
        "SELECT id, username, email, group_id, created_at, password_hash FROM users WHERE id = ?1",
      ),
    ).get(id) ?? null
  );
}
function duplicate(ctx: Ctx, usernameKey: string, email: string): never {
  if (ctx.sqlite.prepare("SELECT id FROM users WHERE username_key = ?1").get(usernameKey))
    throw new ConflictError("Username is already in use.");
  if (ctx.sqlite.prepare("SELECT id FROM users WHERE email = ?1").get(email))
    throw new ConflictError("Email is already in use.");
  throw new ConflictError("Username or email is already in use.");
}

export function resolveSessionToken(ctx: Ctx, token: string): Actor | null {
  if (!token.startsWith("sess_")) return null;
  const row = prepared(ctx, "auth.resolveSession", () =>
    ctx.sqlite.prepare<CredentialRow, [string, number]>(
      "SELECT s.id, s.user_id, u.group_id FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1 AND s.expires_at > ?2",
    ),
  ).get(hashToken(token), ctx.now());
  return row
    ? { kind: "user", userId: row.user_id, groupId: row.group_id, sessionId: row.id }
    : null;
}
export function resolveApiToken(ctx: Ctx, token: string): Actor | null {
  if (!token.startsWith("sermo_")) return null;
  const row = prepared(ctx, "auth.resolveApiToken", () =>
    ctx.sqlite.prepare<CredentialRow, [string, number]>(
      "SELECT t.id, t.user_id, u.group_id FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?1 AND (t.expires_at IS NULL OR t.expires_at > ?2)",
    ),
  ).get(hashToken(token), ctx.now());
  return row
    ? { kind: "token", userId: row.user_id, groupId: row.group_id, tokenId: row.id }
    : null;
}
export function purgeExpiredCredentials(ctx: Ctx): { sessions: number; tokens: number } {
  return writeTx(ctx, () => ({
    sessions: ctx.sqlite.prepare("DELETE FROM sessions WHERE expires_at <= ?1").run(ctx.now())
      .changes,
    tokens: ctx.sqlite
      .prepare("DELETE FROM api_tokens WHERE expires_at IS NOT NULL AND expires_at <= ?1")
      .run(ctx.now()).changes,
  }));
}
export async function ensureAdmin(
  ctx: Ctx,
  input: { username: string; email: string; password: string },
): Promise<{ userId: number; created: boolean }> {
  const existingAdmin = ctx.sqlite
    .prepare<{ id: number }, []>(
      "SELECT u.id FROM users u JOIN groups g ON g.id = u.group_id WHERE g.is_admin = 1 LIMIT 1",
    )
    .get();
  if (existingAdmin) return { userId: existingAdmin.id, created: false };
  const usernameKey = input.username.toLowerCase();
  const existing = ctx.sqlite
    .prepare<{ id: number }, [string]>("SELECT id FROM users WHERE username_key = ?1")
    .get(usernameKey);
  const passwordHash = existing
    ? null
    : await Bun.password.hash(input.password, ctx.config.passwordHash);
  return writeTx(ctx, () => {
    const concurrent = ctx.sqlite
      .prepare<{ id: number }, []>(
        "SELECT u.id FROM users u JOIN groups g ON g.id = u.group_id WHERE g.is_admin = 1 LIMIT 1",
      )
      .get();
    if (concurrent) return { userId: concurrent.id, created: false };
    const user = ctx.sqlite
      .prepare<{ id: number }, [string]>("SELECT id FROM users WHERE username_key = ?1")
      .get(usernameKey);
    if (user) {
      ctx.sqlite
        .prepare("UPDATE users SET group_id = ?1 WHERE id = ?2")
        .run(GROUP_IDS.admin, user.id);
      invalidate(ctx, "permissions");
      return { userId: user.id, created: false };
    }
    const email = input.email.toLowerCase();
    if (ctx.sqlite.prepare("SELECT id FROM users WHERE email = ?1").get(email))
      duplicate(ctx, usernameKey, email);
    const created = ctx.sqlite
      .prepare<{ id: number }, [string, string, string, string, number, number]>(
        "INSERT INTO users (username, username_key, email, password_hash, group_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id",
      )
      .get(input.username, usernameKey, email, passwordHash!, GROUP_IDS.admin, ctx.now())!;
    invalidate(ctx, "permissions");
    return { userId: created.id, created: true };
  });
}

export const authRegisterOp = implement(authRegister, async (ctx, actor, input) => {
  if (actor.kind !== "guest") throw new ForbiddenError();
  const usernameKey = input.username.toLowerCase(),
    email = input.email.toLowerCase();
  if (
    ctx.sqlite.prepare("SELECT id FROM users WHERE username_key = ?1").get(usernameKey) ||
    ctx.sqlite.prepare("SELECT id FROM users WHERE email = ?1").get(email)
  )
    duplicate(ctx, usernameKey, email);
  const passwordHash = await Bun.password.hash(input.password, ctx.config.passwordHash);
  return writeTx(ctx, () => {
    if (
      ctx.sqlite.prepare("SELECT id FROM users WHERE username_key = ?1").get(usernameKey) ||
      ctx.sqlite.prepare("SELECT id FROM users WHERE email = ?1").get(email)
    )
      duplicate(ctx, usernameKey, email);
    const row = ctx.sqlite
      .prepare<{ id: number }, [string, string, string, string, number, number]>(
        "INSERT INTO users (username, username_key, email, password_hash, group_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id",
      )
      .get(input.username, usernameKey, email, passwordHash, GROUP_IDS.member, ctx.now())!;
    return { user: self(userById(ctx, row.id)!), session: session(ctx, row.id) };
  });
});
export const authLoginOp = implement(authLogin, async (ctx, _actor, input) => {
  const login = input.login.toLowerCase();
  const row = prepared(ctx, "auth.login", () =>
    ctx.sqlite.prepare<UserRow, [string, string]>(
      "SELECT id, username, email, group_id, created_at, password_hash FROM users WHERE username_key = ?1 OR email = ?2 LIMIT 1",
    ),
  ).get(login, login);
  let valid = false;
  try {
    valid = await Bun.password.verify(input.password, row?.password_hash ?? DUMMY_HASH);
  } catch {
    /* Invalid stored hash is never a valid login. */
  }
  if (!row || !valid) throw new UnauthenticatedError("Invalid login or password.");
  return writeTx(ctx, () => ({ user: self(row), session: session(ctx, row.id) }));
});
export const authLogoutOp = implement(authLogout, (ctx, actor) => {
  const current = requireSession(actor);
  writeTx(ctx, () =>
    ctx.sqlite
      .prepare("DELETE FROM sessions WHERE id = ?1 AND user_id = ?2")
      .run(current.sessionId, current.userId),
  );
  return { ok: true as const };
});
export const authMeOp = implement(authMe, (ctx, actor) => {
  const row = actor.kind === "guest" ? null : userById(ctx, actor.userId);
  if (actor.kind !== "guest" && !row) throw new NotFoundError();
  return { user: row ? self(row) : null, permissions: getGlobalPermissions(ctx, actor) };
});
export const authCreateTokenOp = implement(authCreateToken, (ctx, actor, input) => {
  const current = requireSession(actor);
  const token = newToken("sermo_"),
    now = ctx.now();
  const expiresAt = input.expiresInDays == null ? null : now + input.expiresInDays * DAY;
  const row = writeTx(
    ctx,
    () =>
      ctx.sqlite
        .prepare<TokenRow, [number, string, string, number, number | null]>(
          "INSERT INTO api_tokens (user_id, name, token_hash, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id, name, created_at, expires_at",
        )
        .get(current.userId, input.name, hashToken(token), now, expiresAt)!,
  );
  return { token, apiToken: tokenValue(row) };
});
export const authListTokensOp = implement(authListTokens, (ctx, actor) => {
  const current = requireSession(actor);
  const rows = prepared(ctx, "auth.listTokens", () =>
    ctx.sqlite.prepare<TokenRow, [number]>(
      "SELECT id, name, created_at, expires_at FROM api_tokens WHERE user_id = ?1 ORDER BY id DESC",
    ),
  ).all(current.userId);
  return { items: rows.map(tokenValue) };
});
export const authRevokeTokenOp = implement(authRevokeToken, (ctx, actor, input) => {
  const current = requireSession(actor);
  return writeTx(ctx, () => {
    const result = ctx.sqlite
      .prepare("DELETE FROM api_tokens WHERE id = ?1 AND user_id = ?2")
      .run(input.tokenId, current.userId);
    if (!result.changes) throw new NotFoundError();
    return { ok: true };
  });
});
export const operations = [
  authRegisterOp,
  authLoginOp,
  authLogoutOp,
  authMeOp,
  authCreateTokenOp,
  authListTokensOp,
  authRevokeTokenOp,
];
