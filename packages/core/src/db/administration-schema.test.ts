import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getTableColumns } from "drizzle-orm";
import journal from "../../drizzle/meta/_journal.json";
import { type Ctx, closeContext, createContext } from "../context";
import { createTestContext, expectNoTableScan, insertUser } from "../testing";
import * as schema from "./schema";

const open: Ctx[] = [];
afterEach(() => {
  for (const ctx of open.splice(0)) closeContext(ctx);
});

describe("administration schema matches the migration", () => {
  test("users columns are the schema's, and the rename time is nullable", () => {
    const ctx = createTestContext();
    open.push(ctx);
    const columns = ctx.sqlite
      .prepare<{ name: string; notnull: number }, []>("PRAGMA table_xinfo(users)")
      .all();
    expect(columns.map((column) => column.name).sort()).toEqual(
      Object.values(getTableColumns(schema.users))
        .map((column) => column.name)
        .sort(),
    );
    expect(columns.find((column) => column.name === "username_changed_at")?.notnull).toBe(0);
  });

  test("the banned members have a partial index the newest-first walk uses", () => {
    const ctx = createTestContext();
    open.push(ctx);
    const index = ctx.sqlite
      .prepare<{ sql: string }, []>(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'users_banned'",
      )
      .get();
    expect(index?.sql).toContain("(`id`) WHERE banned_permanently = 1 OR banned_until IS NOT NULL");
    expectNoTableScan(
      ctx,
      "SELECT id FROM users WHERE (banned_permanently = 1 OR banned_until IS NOT NULL) AND id < ?1 ORDER BY id DESC LIMIT ?2",
      [100, 10],
    );
    const plan = ctx.sqlite
      .prepare<{ detail: string }, [number]>(
        "EXPLAIN QUERY PLAN SELECT id FROM users WHERE (banned_permanently = 1 OR banned_until IS NOT NULL) AND id < ?1 ORDER BY id DESC",
      )
      .all(100);
    expect(plan.map((row) => row.detail).join(" ")).toContain("users_banned");
  });
});

describe("migration 0025 on a database that already holds members", () => {
  test("adds the rename time as null for everyone and the index", () => {
    const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
    open.push(ctx);
    ctx.sqlite.transaction(() => {
      for (const entry of journal.entries.filter((entry) => entry.idx <= 24)) {
        const sql = readFileSync(
          new URL(`../../drizzle/${entry.tag}.sql`, import.meta.url),
          "utf8",
        );
        for (const statement of sql.split("--> statement-breakpoint")) ctx.sqlite.run(statement);
      }
    })();
    const member = insertUser(ctx);
    const entry = journal.entries.find((candidate) => candidate.idx === 25)!;
    const sql = readFileSync(new URL(`../../drizzle/${entry.tag}.sql`, import.meta.url), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) ctx.sqlite.run(statement);
    expect(
      ctx.sqlite
        .prepare<{ at: number | null }, [number]>(
          "SELECT username_changed_at AS at FROM users WHERE id = ?1",
        )
        .get(member.id),
    ).toEqual({ at: null });
  });
});
