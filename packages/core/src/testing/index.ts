/**
 * Test helpers. Import from "@sermo/core/testing" in tests only.
 */
import { expect } from "bun:test";
import type { Actor } from "../actor";
import { type Ctx, createContext } from "../context";
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

/** A fresh, migrated in-memory database with cheap password hashing and output validation on. */
export function createTestContext(options: { clock?: TestClock } = {}): Ctx & { clock: TestClock } {
  const clock = options.clock ?? createTestClock();
  const ctx = createContext({
    path: ":memory:",
    migrate: true,
    now: clock.now,
    config: {
      passwordHash: { algorithm: "argon2id", memoryCost: 8, timeCost: 1 },
      validateOutput: true,
      auth: {
        secret: "test-secret-for-sermo-tests-0123456789abcdef",
        baseURL: "http://localhost:3000",
        trustedOrigins: [],
        ipAddressHeaders: [],
      },
    },
  });
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
