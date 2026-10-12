import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { getTableColumns } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import journal from "../../drizzle/meta/_journal.json";
import { type Ctx, closeContext, createContext } from "../context";
import { createTestContext, insertUser } from "../testing";
import * as schema from "./schema";

const open: Ctx[] = [];
afterEach(() => {
  for (const ctx of open.splice(0)) closeContext(ctx);
});

describe("member profile schema matches the migration", () => {
  const ctx = createTestContext();
  const columns = (table: string) =>
    ctx.sqlite
      .prepare<{ name: string; notnull: number; dflt_value: string | null }, []>(
        `PRAGMA table_xinfo(${table})`,
      )
      .all();

  const tables: [string, SQLiteTable][] = [
    ["groups", schema.groups],
    ["users", schema.users],
    ["member_month_stats", schema.memberMonthStats],
    ["month_winners", schema.monthWinners],
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

  test("optional profile columns are nullable and the others default to empty", () => {
    const users = columns("users");
    for (const name of [
      "custom_title",
      "signature_source",
      "signature_html",
      "birthday_md",
      "birth_year",
      "referred_by",
      "referred_at",
    ])
      expect(users.find((column) => column.name === name)?.notnull, name).toBe(0);
    for (const name of ["location", "website", "social_discord", "social_telegram", "social_x"])
      expect(users.find((column) => column.name === name)?.dflt_value, name).toBe("''");
  });

  test("the indexes exist with the columns and filters the queries rely on", () => {
    const index = (name: string) =>
      ctx.sqlite
        .prepare<{ sql: string; tbl_name: string }, [string]>(
          "SELECT sql, tbl_name FROM sqlite_master WHERE type = 'index' AND name = ?1",
        )
        .get(name);
    for (const [name, text] of [
      ["users_post_count", '"post_count" desc,`id`'],
      ["users_reaction_score", '"reaction_score" desc,`id`'],
      ["users_award_xp", '"award_xp" desc,`id`'],
      ["users_credits", '"credits" desc,`id`'],
      ["users_award_count", '"award_count" desc,`id`'],
      ["users_referral_count", '"referral_count" desc,`id`'],
      ["users_birthday", "`birthday_md`,`id`"],
      ["users_group", "`group_id`,`id`"],
      ["users_referred_at", "`referred_at`"],
      ["member_month_stats_standing", '`month`,"points_tenths" desc,"posts" desc,`user_id`'],
      ["member_month_stats_member", "`month`,`user_id`"],
    ] as const)
      expect(index(name)?.sql, name).toContain(text);
    expect(index("users_birthday")!.sql).toContain("WHERE birthday_md IS NOT NULL");
    expect(index("users_referred_at")!.sql).toContain("WHERE referred_at IS NOT NULL");
    expect(index("member_month_stats_member")!.sql).toContain("UNIQUE");
  });
});

function replay(ctx: Ctx, from: number, through: number) {
  ctx.sqlite.transaction(() => {
    for (const entry of journal.entries.filter(
      (entry) => entry.idx >= from && entry.idx <= through,
    )) {
      const sql = readFileSync(new URL(`../../drizzle/${entry.tag}.sql`, import.meta.url), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) ctx.sqlite.run(statement);
    }
  })();
}

describe("migration 0023 on a database that already holds data", () => {
  test("backfills award_count from the held grants and marks the built-in staff groups", () => {
    const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
    open.push(ctx);
    replay(ctx, 0, 22);
    const holder = insertUser(ctx);
    const stacked = insertUser(ctx);
    const none = insertUser(ctx);
    const award = (name: string) =>
      ctx.sqlite
        .prepare<{ id: number }, [string]>(
          "INSERT INTO awards (name, tier, created_at, updated_at) VALUES (?1, 'bronze', 0, 0) RETURNING id",
        )
        .get(name)!.id;
    const [first, second] = [award("first"), award("second")];
    const total = ctx.sqlite.prepare(
      "INSERT INTO member_award_totals (user_id, award_id, count) VALUES (?1, ?2, ?3)",
    );
    total.run(holder.id, first, 1);
    total.run(stacked.id, first, 3);
    total.run(stacked.id, second, 2);
    total.run(none.id, second, 0);

    replay(ctx, 23, 23);

    const counts = ctx.sqlite
      .prepare<{ id: number; award_count: number }, []>("SELECT id, award_count FROM users")
      .all();
    const count = (id: number) => counts.find((row) => row.id === id)?.award_count;
    expect(count(holder.id)).toBe(1);
    expect(count(stacked.id)).toBe(5);
    expect(count(none.id)).toBe(0);
    expect(
      ctx.sqlite
        .prepare<{ builtin: string | null }, []>(
          "SELECT builtin FROM groups WHERE is_staff = 1 ORDER BY id",
        )
        .all()
        .map((row) => row.builtin),
    ).toEqual(["moderator", "admin"]);
  });
});
