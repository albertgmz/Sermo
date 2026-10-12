import { describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { createTestContext } from "../testing";
import * as schema from "./schema";

describe("appearance schema matches the migration", () => {
  const ctx = createTestContext();
  const columns = (table: string) =>
    ctx.sqlite
      .prepare<{ name: string; notnull: number; dflt_value: string | null }, []>(
        `PRAGMA table_info(${table})`,
      )
      .all();

  const tables: [string, SQLiteTable][] = [
    ["catalog_images", schema.catalogImages],
    ["palette_colors", schema.paletteColors],
    ["users", schema.users],
    ["threads", schema.threads],
    ["files", schema.files],
    ["awards", schema.awards],
    ["shop_items", schema.shopItems],
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

  test("the new columns are nullable and the catalogs default to active at position 0", () => {
    const nullable: [string, string[]][] = [
      ["users", ["accent_color_id", "name_color_id", "frame_id", "cover_preset_id"]],
      ["threads", ["cover_id"]],
      ["files", ["meta"]],
      ["awards", ["image_file_id"]],
      ["shop_items", ["image_file_id"]],
    ];
    for (const [table, names] of nullable)
      for (const name of names) {
        const column = columns(table).find((candidate) => candidate.name === name);
        expect(column, `${table}.${name}`).toBeDefined();
        expect(column!.notnull).toBe(0);
      }
    for (const table of ["catalog_images", "palette_colors"]) {
      const byName = new Map(columns(table).map((column) => [column.name, column]));
      expect(byName.get("is_active")).toMatchObject({ notnull: 1 });
      expect(byName.get("position")).toMatchObject({ notnull: 1, dflt_value: "0" });
    }
  });

  test("the partial indexes and the catalog indexes exist", () => {
    const index = (name: string) =>
      ctx.sqlite
        .prepare<{ sql: string; tbl_name: string }, [string]>(
          "SELECT sql, tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?1",
        )
        .get(name);
    for (const [name, table, column] of [
      ["users_accent_color", "users", "accent_color_id"],
      ["users_name_color", "users", "name_color_id"],
      ["users_frame", "users", "frame_id"],
      ["users_cover_preset", "users", "cover_preset_id"],
      ["threads_cover", "threads", "cover_id"],
    ] as const) {
      const found = index(name);
      expect(found?.tbl_name, name).toBe(table);
      expect(found!.sql).toContain(`WHERE ${column} IS NOT NULL`);
    }
    expect(index("catalog_images_kind")?.sql).toContain("`kind`,`position`,`id`");
    expect(index("palette_colors_kind")?.sql).toContain("`kind`,`position`,`id`");
  });
});

describe("the default palette", () => {
  test("a migrated empty database holds the 25 default colours in order", () => {
    const ctx = createTestContext();
    const rows = ctx.sqlite
      .prepare<
        {
          kind: string;
          name: string;
          color: string;
          foreground: string | null;
          position: number;
          is_active: number;
          created_at: number;
          updated_at: number;
        },
        []
      >("SELECT * FROM palette_colors ORDER BY id")
      .all();
    expect(rows).toHaveLength(25);
    const summary = (kind: string) =>
      rows
        .filter((row) => row.kind === kind)
        .map((row) => [row.position, row.name, row.color, row.foreground]);
    expect(summary("accent")).toEqual([
      [0, "Red", "#dc2626", "#ffffff"],
      [1, "Orange", "#ea580c", "#1a0a03"],
      [2, "Amber", "#f59e0b", "#1c1304"],
      [3, "Emerald", "#10b981", "#022c22"],
      [4, "Sky", "#0ea5e9", "#03131f"],
      [5, "Violet", "#8452f6", "#ffffff"],
    ]);
    expect(summary("name")).toEqual([
      [0, "Rose", "#fb7185", null],
      [1, "Coral", "#fb923c", null],
      [2, "Lime", "#a3e635", null],
      [3, "Emerald", "#34d399", null],
      [4, "Cyan", "#22d3ee", null],
      [5, "Sky", "#60a5fa", null],
      [6, "Indigo", "#818cf8", null],
      [7, "Pink", "#f472b6", null],
      [8, "Silver", "#c4c4cc", null],
      [9, "Gold", "#eab308", null],
      [10, "Legendary", "#a78bfa", null],
    ]);
    expect(summary("prefix")).toEqual([
      [0, "Sky", "#60a5fa", null],
      [1, "Emerald", "#34d399", null],
      [2, "Orange", "#fb923c", null],
      [3, "Violet", "#818cf8", null],
      [4, "Amber", "#eab308", null],
      [5, "Cyan", "#22d3ee", null],
      [6, "Rose", "#fb7185", null],
      [7, "Lime", "#a3e635", null],
    ]);
    expect(rows.every((row) => row.is_active === 1)).toBe(true);
    expect(rows.every((row) => row.created_at > 0 && row.updated_at === row.created_at)).toBe(true);
    expect(ctx.sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_images").get()).toEqual({ n: 0 });
  });
});
