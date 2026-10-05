import type { Database } from "bun:sqlite";
import { type Db, openDatabase, runMigrations } from "./db/connection";

/** Header the HTTP adapter sets to the client IP it determined (never taken from the client). */
export const CLIENT_IP_HEADER = "x-sermo-client-ip";

export interface AuthConfig {
  /** BETTER_AUTH_SECRET: signs session cookies; at least 32 random characters. */
  secret: string;
  /** Public origin of the server, e.g. https://forum.example.com. Always a trusted origin. */
  baseURL: string;
  /** Extra origins allowed to make cookie-authenticated requests (e.g. the frontend). */
  trustedOrigins: string[];
  /**
   * Request header that carries the client IP for rate limiting. The HTTP adapter always sets it
   * itself (from the socket, or from the configured trusted proxy header) and drops any value the
   * client sent, so it can be trusted. Defaults to CLIENT_IP_HEADER.
   */
  clientIpHeader: string;
}

export interface CoreConfig {
  /** Options for Bun.password.hash. Production uses Bun's defaults; only tests lower the cost. */
  passwordHash: Bun.Password.Argon2Algorithm | Bun.Password.BCryptAlgorithm;
  sessionTtlMs: number;
  /** Required by the auth module; the server reads it from the environment. */
  auth?: AuthConfig;
  /** Optional origin that proxies public profile and node images. */
  publicFileBaseURL?: string;
  /** Validate every operation's output against its contract (on in tests, off in production). */
  validateOutput: boolean;
}

export const DEFAULT_CONFIG: CoreConfig = {
  // Bun's default argon2id cost. Password hashing is exempt from the latency budgets.
  passwordHash: { algorithm: "argon2id" },
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000,
  validateOutput: false,
};

/**
 * Everything a service needs. One per process per database file.
 * Services never hold module-level state; per-database state lives here.
 */
export interface Ctx {
  readonly db: Db;
  readonly sqlite: Database;
  readonly config: CoreConfig;
  now(): number;
  /** Buffered thread view counts (threadId -> pending views), flushed by a scheduled job. */
  readonly views: Map<number, number>;
  /** Buffered attachment downloads, flushed with thread views. */
  readonly downloads: Map<number, number>;
  /** Internal: versioned in-memory caches. Use `cached` / `invalidate`. */
  readonly caches: Map<string, { version: number; value: unknown }>;
  /** Internal: prepared statements. Use `prepared`. */
  readonly statements: Map<string, unknown>;
}

export interface CreateContextOptions {
  path: string;
  /** Apply pending migrations (default false). Only the process that owns the schema should. */
  migrate?: boolean;
  now?: () => number;
  config?: Partial<CoreConfig>;
}

export function createContext(options: CreateContextOptions): Ctx {
  const db = openDatabase(options.path);
  if (options.migrate) runMigrations(db);
  return {
    db,
    sqlite: db.$client,
    config: { ...DEFAULT_CONFIG, ...options.config },
    now: options.now ?? Date.now,
    views: new Map(),
    downloads: new Map(),
    caches: new Map(),
    statements: new Map(),
  };
}

/**
 * Closes the database immediately. `close(true)` finalizes outstanding statements; the default
 * deferred close keeps the file locked on Windows while any statement is still alive.
 */
export function closeContext(ctx: Ctx): void {
  ctx.statements.clear();
  ctx.sqlite.close(true);
}

/**
 * Returns a prepared statement, building it once per database. Use for every hot query:
 *
 *   const q = prepared(ctx, "threads.byId", () =>
 *     ctx.db.select().from(threads).where(eq(threads.id, sql.placeholder("id"))).prepare());
 *   q.get({ id });
 *
 * Keys must be unique across the codebase; prefix them with the module name.
 */
export function prepared<T>(ctx: Ctx, key: string, build: () => T): T {
  let stmt = ctx.statements.get(key) as T | undefined;
  if (stmt === undefined) {
    stmt = build();
    ctx.statements.set(key, stmt);
  }
  return stmt;
}

/** Cache keys backed by rows in `cache_versions`. */
export type CacheKey = "node_tree" | "permissions" | "reaction_types";

/**
 * Returns a cached value for `key`, rebuilding it when the key's version in `cache_versions`
 * changed (possibly from another process). Costs one indexed lookup per call.
 *
 * Inside a transaction the value is built but never stored: the transaction may have changed
 * (and may still roll back) the data the value is built from.
 */
export function cached<T>(ctx: Ctx, key: CacheKey, build: () => T): T {
  if (ctx.sqlite.inTransaction) return build();
  const version = readCacheVersion(ctx, key);
  const entry = ctx.caches.get(key);
  if (entry && entry.version === version) return entry.value as T;
  const value = build();
  ctx.caches.set(key, { version, value });
  return value;
}

/** Bumps the version of a cache key. Call inside the write transaction that changed the data. */
export function invalidate(ctx: Ctx, key: CacheKey): void {
  prepared(ctx, "core.cacheBump", () =>
    ctx.sqlite.prepare<unknown, [string]>(
      "INSERT INTO cache_versions (key, version) VALUES (?1, 1) " +
        "ON CONFLICT (key) DO UPDATE SET version = version + 1",
    ),
  ).run(key);
  ctx.caches.delete(key);
}

function readCacheVersion(ctx: Ctx, key: CacheKey): number {
  const stmt = prepared(ctx, "core.cacheVersion", () =>
    ctx.sqlite.prepare<{ version: number }, [string]>(
      "SELECT version FROM cache_versions WHERE key = ?1",
    ),
  );
  return stmt.get(key)?.version ?? 0;
}
