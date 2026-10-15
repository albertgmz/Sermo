import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import journal from "../../drizzle/meta/_journal.json";
import { GUEST } from "../actor";
import { type Ctx, closeContext, createContext } from "../context";
import { execute } from "../operation";
import { getOperation } from "../operations";
import { insertUser, userActor } from "../testing";

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

// The database as migration 0035 left it, with the rows a site that used the old formats holds.
function before() {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, 35);
  return ctx;
}
const NONE = '{"match":"all","conditions":[]}';

test("migration 0036 turns every promotion's and award's list into an `all` rule, unchanged", () => {
  const ctx = before();
  const lists = [
    '[{"criterion":"post_count","value":25},{"criterion":"email_verified","value":1}]',
    '[{"criterion":"purchased_item","value":7}]',
    "[]",
  ];
  const insertPromotion = ctx.sqlite.prepare(
    "INSERT INTO promotions (title, criteria, group_ids, created_at, updated_at) VALUES (?1, ?2, '[3]', 0, 0)",
  );
  const insertAward = ctx.sqlite.prepare(
    "INSERT INTO awards (name, tier, criteria, created_at, updated_at) VALUES (?1, 'gold', ?2, 0, 0)",
  );
  lists.forEach((list, index) => {
    insertPromotion.run(`P${index}`, list);
    insertAward.run(`A${index}`, list);
  });
  applyMigrations(ctx, 36, 36);

  const rules = (table: string) =>
    ctx.sqlite
      .prepare<{ rule: string }, []>(`SELECT rule FROM ${table} ORDER BY id`)
      .all()
      .map((row) => JSON.parse(row.rule));
  const expected = lists.map((list) => ({ match: "all", conditions: JSON.parse(list) }));
  expect(rules("promotions")).toEqual(expected);
  expect(rules("awards")).toEqual(expected);
  for (const table of ["promotions", "awards"])
    expect(
      ctx.sqlite
        .prepare<{ name: string }, []>(`SELECT name FROM pragma_table_info('${table}')`)
        .all()
        .map((column) => column.name),
    ).not.toContain("criteria");
});

test("migration 0036 turns notice audiences into rules and keeps who sees what", async () => {
  const ctx = before();
  ctx.sqlite.run("PRAGMA foreign_keys = OFF");
  const adminUser = insertUser(ctx, { groupId: 4 });
  const memberUser = insertUser(ctx);
  const moderatorUser = insertUser(ctx, { groupId: 3 });
  const secondary = insertUser(ctx);
  ctx.sqlite
    .prepare("INSERT INTO user_groups (user_id, group_id, created_at) VALUES (?1, 3, 0)")
    .run(secondary.id);
  const insert = ctx.sqlite.prepare(
    "INSERT INTO notices (title, body_source, body_html, audience, audience_group_id, created_by, created_at, updated_at) VALUES (?1, '', '', ?2, ?3, ?4, 0, 0)",
  );
  insert.run("Everyone", "everyone", null, adminUser.id);
  insert.run("Guests", "guests", null, adminUser.id);
  insert.run("Members", "members", null, adminUser.id);
  insert.run("Moderators", "group", 3, adminUser.id);
  // A group notice that lost its group was shown to nobody.
  insert.run("Nobody", "group", null, adminUser.id);
  applyMigrations(ctx, 36, 36);

  const stored = ctx.sqlite
    .prepare<{ title: string; rule: string; active: number }, []>(
      "SELECT title, rule, active FROM notices ORDER BY id",
    )
    .all()
    .map((row) => [row.title, JSON.parse(row.rule), row.active]);
  expect(stored).toEqual([
    ["Everyone", { match: "all", conditions: [] }, 1],
    ["Guests", { match: "all", conditions: [{ criterion: "is_guest", value: 1 }] }, 1],
    ["Members", { match: "all", conditions: [{ criterion: "is_guest", value: 0 }] }, 1],
    ["Moderators", { match: "all", conditions: [{ criterion: "in_group", ids: [3] }] }, 1],
    ["Nobody", { match: "all", conditions: [] }, 0],
  ]);
  expect(
    ctx.sqlite
      .prepare<{ name: string }, []>("SELECT name FROM pragma_table_info('notices')")
      .all()
      .map((column) => column.name),
  ).not.toContain("audience");

  const titles = async (actor: Parameters<typeof execute>[2]) =>
    (
      (await execute(ctx, getOperation("notices.current"), actor, {})) as {
        items: { title: string }[];
      }
    ).items.map((item) => item.title);
  expect(await titles(GUEST)).toEqual(["Guests", "Everyone"]);
  expect(await titles(userActor(memberUser))).toEqual(["Members", "Everyone"]);
  expect(await titles(userActor(adminUser))).toEqual(["Members", "Everyone"]);
  expect(await titles(userActor(moderatorUser))).toEqual(["Moderators", "Members", "Everyone"]);
  expect(await titles(userActor(secondary))).toEqual(["Moderators", "Members", "Everyone"]);
});

test("existing shop categories and items stay for everyone", () => {
  const ctx = before();
  const category = ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO shop_categories (name, created_at, updated_at) VALUES ('Cat', 0, 0) RETURNING id",
    )
    .get()!.id;
  ctx.sqlite
    .prepare(
      "INSERT INTO shop_items (category_id, name, price, effect, created_at, updated_at) VALUES (?1, 'Item', 5, '{}', 0, 0)",
    )
    .run(category);
  applyMigrations(ctx, 36, 36);
  for (const table of ["shop_categories", "shop_items"])
    expect(ctx.sqlite.prepare<{ rule: string }, []>(`SELECT rule FROM ${table}`).all()).toEqual([
      { rule: NONE },
    ]);
});
