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

const stamp = "CAST(unixepoch('subsec') * 1000 AS INTEGER)";

test("migration 0078 renames the feed's widget positions, its built-in menu keys and the menu addresses in place", () => {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, 77);
  // An administrator's own entries: two lead to the old feed address, one to a thread that merely
  // has the word in its address.
  for (const [title, target] of [
    ["Hot", "/novedades?tab=hot"],
    ["Sub-page", "/novedades/posts/"],
    ["Unrelated", "/threads/3-novedades-del-dia"],
  ] as const)
    ctx.sqlite.run(
      `INSERT INTO navigation_entries (location, title, target, position, created_at, updated_at) VALUES ('footer', ?1, ?2, 9, ${stamp}, ${stamp})`,
      [title, target],
    );
  const positions = () =>
    ctx.sqlite
      .query<{ position: string; type: string; display_order: number }, []>(
        "SELECT position, type, display_order FROM widgets ORDER BY id",
      )
      .all();
  const menu = () =>
    ctx.sqlite
      .query<{ builtin: string | null; title: string; target: string | null }, []>(
        "SELECT builtin, title, target FROM navigation_entries WHERE builtin LIKE '%novedades' OR builtin LIKE '%whats_new' OR title IN ('Hot', 'Sub-page', 'Unrelated') ORDER BY id",
      )
      .all();

  const before = positions();
  expect(before.filter((row) => row.position.startsWith("novedades_")).length).toBe(5);
  expect(menu().map((row) => row.builtin)).toEqual([
    "header.novedades",
    "mobile.novedades",
    null,
    null,
    null,
  ]);

  applyMigrations(ctx, 78, 78);

  const after = positions();
  expect(after.map((row) => row.position)).toEqual(
    before.map((row) => row.position.replace("novedades_", "whats_new_")),
  );
  // Nothing else about a widget changes.
  expect(after.map(({ type, display_order }) => [type, display_order])).toEqual(
    before.map(({ type, display_order }) => [type, display_order]),
  );
  expect(menu()).toEqual([
    { builtin: "header.whats_new", title: "What's new", target: "/whats-new" },
    { builtin: "mobile.whats_new", title: "What's new", target: "/whats-new" },
    { builtin: null, title: "Hot", target: "/whats-new?tab=hot" },
    { builtin: null, title: "Sub-page", target: "/whats-new/posts/" },
    { builtin: null, title: "Unrelated", target: "/threads/3-novedades-del-dia" },
  ]);
});
