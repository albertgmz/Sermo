import { describe, expect, test } from "bun:test";
import { createContext } from "../context";
import { closeTestDatabases, createTestClock, createTestContext, TEST_CACHE_KIB } from "./index";

const PRAGMAS = ["busy_timeout", "synchronous", "journal_size_limit", "foreign_keys", "temp_store"];

/** Some migrations stamp rows with the real time, which differs between any two builds. */
function withoutWallClock(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !/_at$/.test(key)));
}

function dump(ctx: { sqlite: import("bun:sqlite").Database }) {
  const tables = ctx.sqlite
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .filter(
      (t) => !t.name.startsWith("sqlite_") && !/_(content|data|idx|docsize|config)$/.test(t.name),
    );
  return {
    schema: ctx.sqlite
      .query<{ type: string; name: string; sql: string | null }, []>(
        "SELECT type, name, sql FROM sqlite_master ORDER BY type, name",
      )
      .all(),
    rows: Object.fromEntries(
      tables.map((t) => [
        t.name,
        ctx.sqlite
          .query<Record<string, unknown>, []>(`SELECT * FROM "${t.name}" ORDER BY 1, 2`)
          .all()
          .map(withoutWallClock),
      ]),
    ),
  };
}

describe("createTestContext", () => {
  test("is the same database a migrating context builds", () => {
    const reference = createContext({
      path: ":memory:",
      migrate: true,
      now: createTestClock().now,
    });
    expect(dump(createTestContext())).toEqual(dump(reference));
  });

  test("uses the pragmas of every other connection", () => {
    const reference = createContext({ path: ":memory:" });
    const copy = createTestContext();
    for (const name of PRAGMAS) {
      expect(copy.sqlite.query(`PRAGMA ${name}`).get(), name).toEqual(
        reference.sqlite.query(`PRAGMA ${name}`).get(),
      );
    }
  });

  test("keeps a small page cache, since the copy is already in memory", () => {
    const copy = createTestContext();
    expect(copy.sqlite.query("PRAGMA cache_size").get()).toEqual({
      cache_size: -TEST_CACHE_KIB,
    });
  });

  test("the databases a file opened are closed when it ends", () => {
    closeTestDatabases();
    const a = createTestContext();
    const b = createTestContext();
    expect(closeTestDatabases()).toBe(2);
    expect(() => a.sqlite.query("SELECT 1").get()).toThrow();
    expect(() => b.sqlite.query("SELECT 1").get()).toThrow();
    expect(closeTestDatabases()).toBe(0);
  });

  test("copies are independent of each other", () => {
    const a = createTestContext();
    const b = createTestContext();
    a.sqlite.run("INSERT INTO nodes (type, title, position) VALUES ('forum', 'Only in a', 1)");
    const count = (c: typeof a) =>
      c.sqlite.query<{ n: number }, []>("SELECT count(*) AS n FROM nodes").get()!.n;
    expect(count(a)).toBe(count(b) + 1);
  });

  test("each context has a configuration of its own", () => {
    const a = createTestContext();
    const b = createTestContext();
    a.config.auth!.trustedOrigins!.push("http://changed.example");
    expect(b.config.auth?.trustedOrigins).toEqual([]);
    expect(createTestContext().config.auth?.trustedOrigins).toEqual([]);
  });

  test("stamps permission definitions with the clock it was given", () => {
    const clock = createTestClock(Date.UTC(2030, 5, 5));
    const ctx = createTestContext({ clock });
    const stamps = ctx.sqlite
      .query<{ created_at: number }, []>("SELECT DISTINCT created_at FROM permission_definitions")
      .all();
    expect(stamps).toEqual([{ created_at: Date.UTC(2030, 5, 5) }]);
  });
});
