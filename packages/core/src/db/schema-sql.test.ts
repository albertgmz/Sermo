import { describe, expect, test } from "bun:test";
import { getTableColumns, is, SQL } from "drizzle-orm";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { createTestContext } from "../testing";
import * as schema from "./schema";

describe("Drizzle declarations match the migrations", () => {
  const ctx = createTestContext();
  const dialect = new SQLiteSyncDialect();

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
