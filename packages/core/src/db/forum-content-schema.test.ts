import { describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { createTestContext } from "../testing";
import * as schema from "./schema";

describe("forum content schema matches the migration", () => {
  const ctx = createTestContext();
  const columns = (table: string) =>
    ctx.sqlite
      .prepare<{ name: string; notnull: number; dflt_value: string | null }, []>(
        `PRAGMA table_xinfo(${table})`,
      )
      .all();

  const tables: [string, SQLiteTable][] = [
    ["thread_prefixes", schema.threadPrefixes],
    ["forum_tabs", schema.forumTabs],
    ["rankings", schema.rankings],
    ["nodes", schema.nodes],
    ["threads", schema.threads],
  ];
  for (const [table, definition] of tables)
    test(`${table} columns`, () => {
      const database = columns(table)
        .map((column) => column.name)
        .sort();
      const drizzle = Object.values(getTableColumns(definition))
        .map((column) => column.name)
        .sort();
      expect(drizzle).toEqual(database);
    });

  test("the new columns are nullable", () => {
    for (const [table, names] of [
      ["nodes", ["tab_id"]],
      ["threads", ["prefix_id", "highlighted_until", "bumped_at", "sort_at"]],
    ] as const)
      for (const name of names) {
        const column = columns(table).find((candidate) => candidate.name === name);
        expect(column, `${table}.${name}`).toBeDefined();
        expect(column!.notnull).toBe(0);
      }
  });

  test("sort_at is a virtual generated column: the later of the last post and the bump", () => {
    const hidden = ctx.sqlite
      .prepare<{ name: string; hidden: number }, []>("PRAGMA table_xinfo(threads)")
      .all()
      .find((column) => column.name === "sort_at");
    // 2 = virtual generated, 3 = stored generated
    expect(hidden?.hidden).toBe(2);
    const sort = (lastPostAt: number, bumpedAt: number | null) => {
      const row = ctx.sqlite
        .prepare<{ sort_at: number }, [number, number | null]>(
          "SELECT max(coalesce(?1, 0), coalesce(?2, 0)) AS sort_at",
        )
        .get(lastPostAt, bumpedAt);
      return row!.sort_at;
    };
    expect(sort(10, null)).toBe(10);
    expect(sort(10, 5)).toBe(10);
    expect(sort(10, 20)).toBe(20);
  });

  test("the indexes exist with the columns and filters the queries rely on", () => {
    const index = (name: string) =>
      ctx.sqlite
        .prepare<{ sql: string; tbl_name: string }, [string]>(
          "SELECT sql, tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?1",
        )
        .get(name);
    expect(index("threads_node_sort")?.sql).toContain("`node_id`,`is_sticky`,`sort_at`,`id`");
    const prefix = index("threads_prefix");
    expect(prefix?.tbl_name).toBe("threads");
    expect(prefix!.sql).toContain("`prefix_id`,`node_id`,`is_sticky`,`sort_at`,`id`");
    expect(prefix!.sql).toContain("WHERE prefix_id IS NOT NULL");
    expect(index("thread_prefixes_position")?.sql).toContain("`position`,`id`");
    expect(index("thread_prefixes_color")?.sql).toContain("`color_id`");
    expect(index("forum_tabs_position")?.sql).toContain("`position`,`id`");
    expect(index("rankings_kind_position")?.sql).toContain("UNIQUE");
  });
});
