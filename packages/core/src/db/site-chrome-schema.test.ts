import { describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { createTestContext } from "../testing";
import * as schema from "./schema";

describe("site chrome schema matches the migration", () => {
  const ctx = createTestContext();
  const columns = (table: string) =>
    ctx.sqlite
      .prepare<{ name: string; notnull: number; dflt_value: string | null }, []>(
        `PRAGMA table_xinfo(${table})`,
      )
      .all();

  const tables: [string, SQLiteTable][] = [
    ["navigation_entries", schema.navigationEntries],
    ["static_pages", schema.staticPages],
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

  test("nullability and defaults", () => {
    const column = (table: string, name: string) =>
      columns(table).find((candidate) => candidate.name === name)!;
    for (const name of ["parent_id", "target", "permission", "builtin"])
      expect(column("navigation_entries", name).notnull, name).toBe(0);
    for (const name of ["location", "title", "position", "is_enabled", "audience", "created_at"])
      expect(column("navigation_entries", name).notnull, name).toBe(1);
    expect(column("navigation_entries", "audience").dflt_value).toBe("'everyone'");
    expect(column("navigation_entries", "is_enabled").dflt_value).toBe("true");
    expect(column("static_pages", "is_published").dflt_value).toBe("true");
    for (const name of ["slug", "title", "body_source", "body_html"])
      expect(column("static_pages", name).notnull, name).toBe(1);
  });

  test("the indexes exist with the columns and filters the queries rely on", () => {
    const index = (name: string) =>
      ctx.sqlite
        .prepare<{ sql: string; tbl_name: string }, [string]>(
          "SELECT sql, tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?1",
        )
        .get(name);
    expect(index("navigation_entries_order")?.sql).toContain(
      "`location`,`parent_id`,`position`,`id`",
    );
    const builtin = index("navigation_entries_builtin");
    expect(builtin?.sql).toContain("UNIQUE");
    expect(builtin?.sql).toContain("WHERE builtin IS NOT NULL");
    expect(index("static_pages_slug")?.sql).toContain("UNIQUE");
  });

  test("a migrated empty database holds exactly the built-in navigation", () => {
    const rows = ctx.sqlite
      .prepare<
        {
          location: string;
          parent: string | null;
          title: string;
          target: string | null;
          position: number;
          is_enabled: number;
          audience: string;
          permission: string | null;
          builtin: string;
          created_at: number;
          updated_at: number;
        },
        []
      >(
        "SELECT e.location, p.builtin AS parent, e.title, e.target, e.position, e.is_enabled, e.audience, e.permission, e.builtin, e.created_at, e.updated_at FROM navigation_entries e LEFT JOIN navigation_entries p ON p.id = e.parent_id ORDER BY e.id",
      )
      .all();
    const shown = rows.map((row) => [
      row.builtin,
      row.location,
      row.parent,
      row.title,
      row.target,
      row.position,
      row.audience,
    ]);
    expect(shown).toEqual([
      ["header.home", "header", null, "Home", "/", 0, "everyone"],
      ["header.forums", "header", null, "Forums", "/forums", 1, "everyone"],
      ["header.members", "header", null, "Members", "/members", 2, "everyone"],
      ["account.upgrade", "account", null, "Upgrade", "/upgrade", 2, "members"],
      ["header.awards", "header", null, "Awards", "/awards", 4, "everyone"],
      ["header.credits", "header", null, "Credits", "/credits", 5, "everyone"],
      ["mobile.home", "mobile", null, "Home", "/", 0, "everyone"],
      ["mobile.messages", "mobile", null, "Messages", "/conversations", 2, "members"],
      ["mobile.alerts", "mobile", null, "Alerts", "/notifications", 3, "members"],
      ["mobile.profile", "mobile", null, "Profile", "/account", 4, "members"],
      ["mobile.login", "mobile", null, "Log in", "/login", 5, "guests"],
      ["account.profile", "account", null, "Profile", "/account", 0, "members"],
      ["account.settings", "account", null, "Account", "/account", 1, "members"],
      ["footer.community", "footer", null, "Community", null, 0, "everyone"],
      ["footer.useful", "footer", null, "Useful", null, 1, "everyone"],
      ["footer.legal", "footer", null, "Legal", null, 2, "everyone"],
      ["footer.community.forums", "footer", "footer.community", "Forums", "/forums", 0, "everyone"],
      [
        "footer.community.members",
        "footer",
        "footer.community",
        "Members",
        "/members",
        1,
        "everyone",
      ],
      ["footer.community.awards", "footer", "footer.community", "Awards", "/awards", 2, "everyone"],
      ["footer.useful.credits", "footer", "footer.useful", "Credits", "/credits", 0, "everyone"],
      ["footer.legal.terms", "footer", "footer.legal", "Terms", "/terms", 0, "everyone"],
      ["footer.legal.privacy", "footer", "footer.legal", "Privacy", "/privacy", 1, "everyone"],
      ["footer.legal.notice", "footer", "footer.legal", "Legal notice", "/legal", 2, "everyone"],
      ["footer.legal.contact", "footer", "footer.legal", "Contact", "/contact", 3, "everyone"],
    ]);
    for (const row of rows) {
      expect(row.is_enabled).toBe(1);
      expect(row.permission).toBeNull();
      expect(row.created_at).toBeGreaterThan(1_700_000_000_000);
      expect(row.updated_at).toBeGreaterThan(1_700_000_000_000);
    }
    expect(
      ctx.sqlite.prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM static_pages").get()!.n,
    ).toBe(0);
  });
});
