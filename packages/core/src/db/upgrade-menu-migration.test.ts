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
  location: string;
  parent_id: number | null;
  title: string;
  position: number;
  is_enabled: number;
  audience: string;
  permission: string | null;
  builtin: string | null;
};

function before() {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, 29);
  const rows = (where: string) =>
    ctx.sqlite
      .prepare<Row, []>(`SELECT * FROM navigation_entries WHERE ${where} ORDER BY position, id`)
      .all();
  return { ctx, rows };
}

test("migration 0030 moves the Upgrade link to the account menu and drops the footer one", () => {
  const { ctx, rows } = before();
  const [header] = rows("builtin = 'header.upgrade'");
  applyMigrations(ctx, 30, 30);

  expect(rows("builtin IN ('header.upgrade', 'footer.useful.upgrade')")).toEqual([]);
  expect(rows("location != 'account' AND target = '/upgrade'")).toEqual([]);
  const account = rows("location = 'account'");
  expect(account.map((row) => row.builtin)).toEqual([
    "account.profile",
    "account.settings",
    "account.upgrade",
  ]);
  expect(account[2]).toMatchObject({ id: header!.id, audience: "members", is_enabled: 1 });
  // The footer column keeps its other link.
  expect(rows("builtin LIKE 'footer.useful.%'").map((row) => row.builtin)).toEqual([
    "footer.useful.credits",
  ]);
});

test("migration 0030 keeps what an administrator changed on the entry", () => {
  const { ctx, rows } = before();
  const [header] = rows("builtin = 'header.upgrade'");
  ctx.sqlite
    .prepare(
      "UPDATE navigation_entries SET title = 'Go premium', is_enabled = 0, audience = 'permission', permission = 'shop.buy' WHERE id = ?1",
    )
    .run(header!.id);
  ctx.sqlite
    .prepare(
      "INSERT INTO navigation_entries (location, parent_id, title, target, position, created_at, updated_at) VALUES ('header', ?1, 'Plans', '/pages/plans', 0, 0, 0), ('account', NULL, 'Mine', '/pages/mine', 7, 0, 0)",
    )
    .run(header!.id);
  applyMigrations(ctx, 30, 30);

  const [moved] = rows("builtin = 'account.upgrade'");
  expect(moved).toMatchObject({
    id: header!.id,
    location: "account",
    title: "Go premium",
    is_enabled: 0,
    audience: "permission",
    permission: "shop.buy",
    // After the entry the administrator added at 7.
    position: 8,
  });
  expect(rows("title = 'Plans'")[0]).toMatchObject({ location: "account", parent_id: header!.id });
});
