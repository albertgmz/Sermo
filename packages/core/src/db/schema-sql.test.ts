import { Database } from "bun:sqlite";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import { getTableColumns, is, SQL } from "drizzle-orm";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { createTestContext } from "../testing";
import * as authSchema from "./auth-schema";
import * as schema from "./schema";

// Preserve string literals and expression grouping while ignoring SQL formatting and identifier quotes.
function sqlTokens(sql: string): string[] {
  return [
    ...sql.matchAll(
      /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\/|[\w]+|<>|!=|<=|>=|\|\||[^\s]/g,
    ),
  ]
    .map(([token]) => token)
    .filter((token) => !token.startsWith("--") && !token.startsWith("/*"))
    .map((token) => {
      if (token.startsWith("'")) return token;
      return token.replace(/^(["`[])(.*)["`\]]$/, "$2").toLowerCase();
    });
}

function checkExpressions(sql: string): string[] {
  const tokens = sqlTokens(sql);
  const checks: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== "check" || tokens[i + 1] !== "(") continue;
    const start = i + 2;
    let depth = 1;
    i = start;
    while (i < tokens.length && depth > 0) {
      if (tokens[i] === "(") depth++;
      if (tokens[i] === ")") depth--;
      i++;
    }
    expect(depth, "balanced CHECK expression").toBe(0);
    checks.push(tokens.slice(start, i - 1).join(" "));
  }
  return checks.sort();
}

function indexes(database: Database, table: string) {
  return database
    .prepare<{ name: string; sql: string | null; is_unique: number }, [string]>(
      "SELECT m.name, m.sql, i.[unique] AS is_unique FROM sqlite_master m " +
        "JOIN pragma_index_list(?1) i ON i.name = m.name " +
        "WHERE m.type = 'index' AND m.tbl_name = ?1 ORDER BY m.name",
    )
    .all(table)
    .map(({ name, sql, is_unique }) => {
      const tokens = sqlTokens(sql ?? "");
      const where = tokens.indexOf("where");
      return {
        name,
        unique: is_unique === 1,
        // Also retain SQL expressions: pragma_index_xinfo reports their names as null.
        definition: tokens.filter((token) => token !== ";"),
        columns: database
          .prepare<{ name: string | null; desc: number; coll: string }, [string]>(
            "SELECT name, desc, coll FROM pragma_index_xinfo(?1) WHERE key = 1 ORDER BY seqno",
          )
          .all(name),
        predicate: where === -1 ? null : tokens.slice(where + 1).filter((t) => t !== ";"),
      };
    });
}

describe("Drizzle declarations match the migrations", () => {
  const ctx = createTestContext();
  const dialect = new SQLiteSyncDialect();
  const declaredDatabase = new Database(":memory:");
  // Generate in memory: no snapshots, migration files or journal entries are written by this test.
  beforeAll(async () => {
    const empty = await generateSQLiteDrizzleJson({});
    const declared = await generateSQLiteDrizzleJson({ ...schema, ...authSchema });
    for (const sql of await generateSQLiteMigration(empty, declared)) declaredDatabase.exec(sql);
  });
  afterAll(() => {
    declaredDatabase.close();
    ctx.sqlite.close();
  });

  const tables = ctx.sqlite
    .prepare<{ name: string; sql: string }, []>(
      "SELECT m.name, m.sql FROM sqlite_master m JOIN pragma_table_list p ON p.name = m.name " +
        "WHERE m.type = 'table' AND p.type = 'table' AND p.schema = 'main' " +
        "AND m.name NOT LIKE 'sqlite_%' AND m.name <> '__drizzle_migrations' ORDER BY m.name",
    )
    .all();

  test("every ordinary migrated table has a declaration", () => {
    // FTS virtual tables and their SQLite-managed shadow tables have no Drizzle declaration.
    const declared = declaredDatabase
      .prepare<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all();
    expect(declared.map(({ name }) => name)).toEqual(tables.map(({ name }) => name));
  });

  for (const { name, sql } of tables) {
    test(`${name} has matching index names, columns, directions, uniqueness and predicates`, () => {
      expect(indexes(declaredDatabase, name)).toEqual(indexes(ctx.sqlite, name));
    });
    test(`${name} has matching CHECK constraints`, () => {
      const declared = declaredDatabase
        .prepare<{ sql: string }, [string]>(
          "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?1",
        )
        .get(name);
      expect(declared, name).not.toBeNull();
      expect(checkExpressions(declared!.sql)).toEqual(checkExpressions(sql));
    });
  }

  test("indexnow_pending columns", () => {
    const database = ctx.sqlite
      .prepare<{ name: string; type: string; notnull: number; pk: number }, []>(
        "PRAGMA table_info(indexnow_pending)",
      )
      .all();
    expect(database.length).toBeGreaterThan(0);
    const declared = Object.values(getTableColumns(schema.indexnowPending));
    expect(declared.map((c) => c.name).sort()).toEqual(database.map((c) => c.name).sort());
    for (const column of declared) {
      const actual = database.find((c) => c.name === column.name)!;
      expect(column.getSQLType().toUpperCase(), column.name).toBe(actual.type);
      expect(column.notNull || column.primary, column.name).toBe(
        actual.notnull === 1 || actual.pk === 1,
      );
      expect(column.primary, column.name).toBe(actual.pk === 1);
    }
  });

  test("indexnow_pending cascades with its event", () => {
    const keys = ctx.sqlite
      .prepare<{ table: string; from: string; to: string; on_delete: string }, []>(
        "PRAGMA foreign_key_list(indexnow_pending)",
      )
      .all();
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({
      table: "domain_events",
      from: "event_id",
      to: "id",
      on_delete: "CASCADE",
    });
    const [fk] = getTableConfig(schema.indexnowPending).foreignKeys;
    expect(fk!.onDelete).toBe("cascade");
  });

  for (const index of ["threads_public_feed", "threads_node_feed"])
    test(`${index} key columns and directions`, () => {
      const database = ctx.sqlite
        .prepare<{ name: string | null; desc: number; key: number }, [string]>(
          "SELECT name, desc, key FROM pragma_index_xinfo(?1) WHERE key = 1 ORDER BY seqno",
        )
        .all(index);
      const declared = getTableConfig(schema.threads)
        .indexes.find((candidate) => candidate.config.name === index)!
        .config.columns.map((column) => {
          if (!is(column, SQL)) return { name: column.name, desc: 0 };
          const text = dialect.sqlToQuery(column).sql;
          return {
            name: [...text.matchAll(/"([^"]+)"/g)].at(-1)![1]!,
            desc: / desc$/.test(text) ? 1 : 0,
          };
        });
      expect(declared).toEqual(database.map(({ name, desc }) => ({ name: name!, desc })));
    });
});
