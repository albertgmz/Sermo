import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import journal from "../../drizzle/meta/_journal.json";
import { type Ctx, closeContext, createContext } from "../context";

const contexts: Ctx[] = [];
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});

function applyMigrations(ctx: Ctx, from: number, through: number) {
  ctx.sqlite.transaction(() => {
    for (const entry of journal.entries.filter(
      (entry) => entry.idx >= from && entry.idx <= through,
    )) {
      const sql = readFileSync(new URL(`../../drizzle/${entry.tag}.sql`, import.meta.url), "utf8");
      for (const statement of sql.split("--> statement-breakpoint")) ctx.sqlite.run(statement);
    }
  })();
}

type Row = {
  id: number;
  parent_id: number | null;
  title: string;
  target: string | null;
  position: number;
  is_enabled: number;
  audience: string;
  permission: string | null;
  builtin: string | null;
};

function before() {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, 84);
  return ctx;
}

const migrate = (ctx: Ctx) => applyMigrations(ctx, 85, 85);

// The top-level entries of the phone bar in display order (position, then id), as builtin key or
// title, with their position.
const bar = (ctx: Ctx) =>
  ctx.sqlite
    .prepare<Row, []>(
      "SELECT * FROM navigation_entries WHERE location = 'mobile' AND parent_id IS NULL ORDER BY position, id",
    )
    .all()
    .map((row) => [row.builtin ?? row.title, row.position]);

const register = (ctx: Ctx) =>
  ctx.sqlite
    .prepare<Row, []>("SELECT * FROM navigation_entries WHERE builtin = 'mobile.register'")
    .all();

const addEntry = (ctx: Ctx, title: string, position: number) =>
  ctx.sqlite.run(
    "INSERT INTO navigation_entries (location, title, target, position, audience, created_at, updated_at) VALUES ('mobile', ?1, ?2, ?3, 'guests', 0, 0)",
    [title, `/pages/${title.toLowerCase()}`, position],
  );

test("migration 0085 adds Create account for guests to the phone bar, right after Log in", () => {
  const ctx = before();
  migrate(ctx);
  expect(bar(ctx)).toEqual([
    ["mobile.home", 0],
    ["mobile.whats_new", 1],
    ["mobile.messages", 3],
    ["mobile.alerts", 4],
    ["mobile.login", 6],
    ["mobile.register", 7],
  ]);
  const [row] = register(ctx);
  expect(row).toMatchObject({
    parent_id: null,
    title: "Create account",
    target: "/register",
    is_enabled: 1,
    audience: "guests",
    permission: null,
  });
});

test("migration 0085 adds the entry only once and leaves an entry that is already there as it is", () => {
  const ctx = before();
  migrate(ctx);
  ctx.sqlite.run(
    "UPDATE navigation_entries SET title = 'Join us', position = 2, is_enabled = 0 WHERE builtin = 'mobile.register'",
  );
  const stored = register(ctx);
  const order = bar(ctx);
  migrate(ctx);
  expect(register(ctx)).toEqual(stored);
  expect(bar(ctx)).toEqual(order);
});

test("migration 0085 moves the entries after Log in one place down and keeps their order", () => {
  const ctx = before();
  addEntry(ctx, "Rules", 7);
  addEntry(ctx, "Help", 9);
  addEntry(ctx, "First", 0);
  migrate(ctx);
  expect(bar(ctx)).toEqual([
    ["mobile.home", 0],
    ["First", 0],
    ["mobile.whats_new", 1],
    ["mobile.messages", 3],
    ["mobile.alerts", 4],
    ["mobile.login", 6],
    ["mobile.register", 7],
    ["Rules", 8],
    ["Help", 10],
  ]);
});

test("migration 0085 keeps an entry that shares Log in's position after Log in, and puts Create account before it", () => {
  const ctx = before();
  addEntry(ctx, "Rules", 6);
  addEntry(ctx, "Help", 7);
  migrate(ctx);
  expect(bar(ctx).map(([name]) => name)).toEqual([
    "mobile.home",
    "mobile.whats_new",
    "mobile.messages",
    "mobile.alerts",
    "mobile.login",
    "mobile.register",
    "Rules",
    "Help",
  ]);
});

test("migration 0085 puts Create account at the end of the bar when Log in was removed", () => {
  const ctx = before();
  ctx.sqlite.run("DELETE FROM navigation_entries WHERE builtin = 'mobile.login'");
  addEntry(ctx, "Rules", 12);
  migrate(ctx);
  expect(bar(ctx)).toEqual([
    ["mobile.home", 0],
    ["mobile.whats_new", 1],
    ["mobile.messages", 3],
    ["mobile.alerts", 4],
    ["Rules", 12],
    ["mobile.register", 13],
  ]);
});

test("migration 0085 adds the entry to a bar that has no entries", () => {
  const ctx = before();
  ctx.sqlite.run("DELETE FROM navigation_entries WHERE location = 'mobile'");
  migrate(ctx);
  expect(bar(ctx)).toEqual([["mobile.register", 0]]);
});
