/**
 * Test helpers. Import from "@sermo/core/testing" in tests only.
 */
import { Database } from "bun:sqlite";
import { afterAll, afterEach, beforeEach, expect } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import type { Actor } from "../actor";
import { type CoreConfig, type Ctx, createContext, DEFAULT_CONFIG } from "../context";
import * as authSchema from "../db/auth-schema";
import * as sermoSchema from "../db/schema";
import { GROUP_IDS } from "../db/schema";

export interface TestClock {
  now(): number;
  set(ms: number): void;
  advance(ms: number): void;
}

export function createTestClock(start = Date.UTC(2026, 0, 1)): TestClock {
  let t = start;
  return {
    now: () => t,
    set: (ms) => {
      t = ms;
    },
    advance: (ms) => {
      t += ms;
    },
  };
}

/** A new object per context: tests change their own context's configuration. */
function testConfig(): Partial<CoreConfig> {
  return {
    passwordHash: { algorithm: "argon2id", memoryCost: 8, timeCost: 1 },
    validateOutput: true,
    auth: {
      secret: "test-secret-for-sermo-tests-0123456789abcdef",
      baseURL: "http://localhost:3000",
      trustedOrigins: [],
      clientIpHeader: "x-sermo-client-ip",
    },
  };
}

interface MigratedTemplate {
  bytes: Uint8Array;
  /** The clock reading the permission sync stamped its rows with. */
  stampedAt: number;
}

const TEMPLATE_KEY = Symbol.for("sermo.testing.migratedTemplate");

/**
 * The migrated, permission-synced schema, built once per process and kept on `globalThis` so a
 * test runner that reloads modules per file still shares it. Migrating costs about 120 ms; a copy
 * of the serialized database costs well under a millisecond.
 */
function migratedTemplate(): MigratedTemplate {
  const holder = globalThis as { [TEMPLATE_KEY]?: MigratedTemplate };
  if (!holder[TEMPLATE_KEY]) {
    const stampedAt = Date.UTC(2026, 0, 1);
    const ctx = createContext({
      path: ":memory:",
      migrate: true,
      now: () => stampedAt,
      config: testConfig(),
    });
    holder[TEMPLATE_KEY] = { bytes: ctx.sqlite.serialize(), stampedAt };
    ctx.sqlite.close(true);
  }
  return holder[TEMPLATE_KEY]!;
}

/**
 * A test database's page cache: 2 MB instead of the 64 MB a served connection gets. The copy is a
 * 1.5 MB database already held in memory, and a test file may open hundreds of them.
 */
export const TEST_CACHE_KIB = 2048;

/** The databases this file's tests opened and have not closed; `afterAll` closes the rest. */
const openDatabases = new Set<Database>();

/** The databases opened while a test body runs: closed when that test ends. */
const testDatabases = new Set<Database>();
let inTest = false;

try {
  beforeEach(() => {
    inTest = true;
  });
  afterEach(() => {
    inTest = false;
    for (const sqlite of testDatabases) {
      sqlite.close(true);
      openDatabases.delete(sqlite);
    }
    testDatabases.clear();
  });
  afterAll(() => {
    for (const sqlite of openDatabases) sqlite.close(true);
    openDatabases.clear();
  });
} catch {
  // Imported outside a test run (a script, the bench): nothing registers, nothing to close.
}

/** Closes every test database still open; each test file does this when it ends. */
export function closeTestDatabases(): number {
  const count = openDatabases.size;
  for (const sqlite of openDatabases) sqlite.close(true);
  openDatabases.clear();
  return count;
}

/**
 * A fresh, migrated in-memory database with cheap password hashing and output validation on. It is
 * a copy of one migrated template, so it costs a fraction of a millisecond instead of a migration.
 * It is closed when its test file ends, so a file's databases do not outlive it.
 */
export function createTestContext(options: { clock?: TestClock } = {}): Ctx & { clock: TestClock } {
  const clock = options.clock ?? createTestClock();
  const template = migratedTemplate();
  const sqlite = Database.deserialize(template.bytes, { strict: true });
  openDatabases.add(sqlite);
  if (inTest) testDatabases.add(sqlite);
  // The pragmas of `openDatabase` (a deserialized copy starts with SQLite's defaults), except the
  // page cache, which only costs memory on a database that is already in memory (and the memory
  // map, which a deserialized database does not use).
  sqlite.run("PRAGMA busy_timeout = 5000");
  sqlite.run("PRAGMA synchronous = NORMAL");
  sqlite.run("PRAGMA journal_size_limit = 67108864");
  sqlite.run("PRAGMA foreign_keys = ON");
  sqlite.run("PRAGMA temp_store = MEMORY");
  sqlite.run(`PRAGMA cache_size = -${TEST_CACHE_KIB}`);
  const stampedAt = clock.now();
  if (stampedAt !== template.stampedAt) {
    sqlite.run("UPDATE permission_definitions SET created_at = ?", [stampedAt]);
  }
  const ctx: Ctx = {
    db: drizzle({ client: sqlite, schema: { ...sermoSchema, ...authSchema } }),
    sqlite,
    config: { ...DEFAULT_CONFIG, ...testConfig() },
    now: clock.now,
    views: new Map(),
    downloads: new Map(),
    activity: new Map(),
    caches: new Map(),
    statements: new Map(),
  };
  (require("../render") as typeof import("../render")).warmUpRenderer();
  return Object.assign(ctx, { clock });
}

let fixtureCounter = 0;

/**
 * Inserts a user directly into Better Auth's `auth_user` table and Sermo's `users` table, without
 * a credential account, so fixture users cannot sign in. Use the auth module for sign-in tests.
 */
export function insertUser(
  ctx: Ctx,
  fields: { username?: string; groupId?: number; email?: string } = {},
): { id: number; username: string; groupId: number } {
  fixtureCounter += 1;
  const username = fields.username ?? `user${fixtureCounter}`;
  const groupId = fields.groupId ?? GROUP_IDS.member;
  const now = ctx.now();
  const row = ctx.sqlite
    .query<{ id: number }, [string, string, string, string, number]>(
      "INSERT INTO auth_user (name, email, email_verified, username, display_username, created_at, updated_at) " +
        "VALUES (?1, ?2, 0, ?3, ?4, ?5, ?5) RETURNING id",
    )
    .get(
      username,
      fields.email ?? `${username.toLowerCase()}@example.test`,
      username.toLowerCase(),
      username,
      now,
    );
  ctx.sqlite
    .query(
      "INSERT INTO users (id, username, username_key, group_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .run(row!.id, username, username.toLowerCase(), groupId, now);
  return { id: row!.id, username, groupId };
}

/** Inserts a node row directly. Remember node changes must invalidate the node caches. */
export function insertNode(
  ctx: Ctx,
  fields: {
    title?: string;
    type?: "category" | "forum";
    parentId?: number | null;
    position?: number;
  },
): { id: number } {
  fixtureCounter += 1;
  const row = ctx.sqlite
    .query<{ id: number }, [number | null, string, string, number]>(
      "INSERT INTO nodes (parent_id, type, title, position) VALUES (?1, ?2, ?3, ?4) RETURNING id",
    )
    .get(
      fields.parentId ?? null,
      fields.type ?? "forum",
      fields.title ?? `Node ${fixtureCounter}`,
      fields.position ?? fixtureCounter,
    );
  return { id: row!.id };
}

/** A session actor for a user (no real session row; services must not depend on one existing). */
export function userActor(user: { id: number; groupId: number }): Actor {
  return { kind: "user", userId: user.id, groupId: user.groupId, sessionId: 0 };
}

export function tokenActor(user: { id: number; groupId: number }): Actor {
  return { kind: "token", userId: user.id, groupId: user.groupId, tokenId: 0 };
}

/** Tables that are small by design and may be scanned. */
const SMALL_TABLES = new Set([
  "nodes",
  "groups",
  "node_permissions",
  "reaction_types",
  "cache_versions",
  "credit_rules",
  "awards",
  "shop_categories",
]);

/**
 * Asserts that a query's plan never full-scans a large table (`SCAN <table>` in EXPLAIN QUERY
 * PLAN, including covering-index scans) and never sorts with a temporary B-tree (which means the
 * index does not match the ORDER BY). Lookups (`SEARCH`), FTS virtual-table access, scans of
 * small tables and scans of json_each / subquery results are allowed. Table aliases in the SQL
 * are resolved to table names. Pass `allowTempBTree` only for queries over a handful of rows.
 */
export function expectNoTableScan(
  ctx: Ctx,
  sql: string,
  params: unknown[] = [],
  options: { allow?: string[]; allowTempBTree?: boolean } = {},
): void {
  const allowed = new Set([...SMALL_TABLES, ...(options.allow ?? [])]);
  const aliases = new Map<string, string>();
  for (const m of sql.matchAll(
    /\b(?:FROM|JOIN)\s+["`]?(\w+)["`]?(?:\s+(?:AS\s+)?["`]?(\w+)["`]?)?/gi,
  )) {
    const table = m[1]!;
    const alias = m[2];
    if (alias && !/^(?:WHERE|ON|JOIN|LEFT|INNER|CROSS|GROUP|ORDER|LIMIT|USING|AND)$/i.test(alias)) {
      aliases.set(alias, table);
    }
  }
  const rows = ctx.sqlite
    .prepare<{ detail: string }, import("bun:sqlite").SQLQueryBindings[]>(
      `EXPLAIN QUERY PLAN ${sql}`,
    )
    .all(...(params as import("bun:sqlite").SQLQueryBindings[]));
  const offending = rows
    .map((r) => r.detail)
    .filter((detail) => {
      if (detail.includes("TEMP B-TREE")) return !options.allowTempBTree;
      const m = /^SCAN (\S+)/.exec(detail);
      if (!m) return false;
      const target = aliases.get(m[1]!) ?? m[1]!;
      if (detail.includes("VIRTUAL TABLE")) return false;
      if (target === "json_each" || target === "CONSTANT" || target.startsWith("(")) return false;
      return !allowed.has(target);
    });
  expect(
    offending,
    `Query plan scans a table or sorts in a temp B-tree:\n${rows.map((r) => r.detail).join("\n")}\n${sql}`,
  ).toEqual([]);
}

/**
 * Creates an API key the way a browser session must: with the session cookie and the member's
 * current password. `auth` is the Better Auth instance (`getAuth(ctx)`).
 */
export function createKeyFromSession(
  auth: {
    api: {
      createApiKey(input: {
        headers: Headers;
        body: { name: string };
      }): Promise<{ id: string; key: string }>;
    };
  },
  cookie: string,
  name: string,
  password = "password123",
): Promise<{ id: string; key: string }> {
  return auth.api.createApiKey({
    headers: new Headers({ cookie }),
    body: { name, password } as { name: string },
  });
}
