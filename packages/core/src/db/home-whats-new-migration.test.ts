import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import journal from "../../drizzle/meta/_journal.json";
import { type Ctx, closeContext, createContext } from "../context";
import { readSiteSettings } from "../modules/settings";
import { insertUser } from "../testing";

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
  icon: string | null;
  builtin: string | null;
};

function before() {
  const ctx = createContext({ path: ":memory:", config: { validateOutput: true } });
  contexts.push(ctx);
  applyMigrations(ctx, 0, 64);
  const rows = (where: string) =>
    ctx.sqlite
      .prepare<Row, []>(`SELECT * FROM navigation_entries WHERE ${where} ORDER BY position, id`)
      .all();
  const store = (homeTab: unknown) =>
    ctx.sqlite
      .prepare(
        "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, 0) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      )
      .run(JSON.stringify({ ...readSiteSettings(ctx), siteName: "Forum", homeTab }));
  const stored = () =>
    JSON.parse(
      ctx.sqlite
        .prepare<{ value: string }, []>(
          "SELECT value FROM site_settings WHERE key = 'configuration'",
        )
        .get()!.value,
    );
  return { ctx, rows, store, stored };
}

const rule = (criterion: string, value: number) => ({
  match: "all" as const,
  conditions: [{ criterion, value }],
});

test("migration 0065 forgets the Forums home tab: members who chose it, the rules that picked it, a Forums fallback", () => {
  const { ctx, store, stored } = before();
  const forums = insertUser(ctx);
  const hot = insertUser(ctx);
  const none = insertUser(ctx);
  const setTab = ctx.sqlite.prepare("UPDATE users SET home_tab = ?2 WHERE id = ?1");
  setTab.run(forums.id, "forums");
  setTab.run(hot.id, "hot");
  store({
    rules: [
      { rule: rule("is_guest", 1), tab: "hot" },
      { rule: rule("post_count", 100), tab: "forums" },
      { rule: rule("is_guest", 0), tab: "following" },
      { rule: rule("post_count", 5), tab: "forums" },
    ],
    fallback: "forums",
  });
  applyMigrations(ctx, 65, 65);

  const tabs = ctx.sqlite
    .prepare<{ id: number; home_tab: string | null }, []>(
      "SELECT id, home_tab FROM users ORDER BY id",
    )
    .all();
  expect(tabs).toEqual([
    { id: forums.id, home_tab: null },
    { id: hot.id, home_tab: "hot" },
    { id: none.id, home_tab: null },
  ]);
  // The other rules keep their order; the rest of the configuration is untouched.
  expect(stored().homeTab).toEqual({
    rules: [
      { rule: rule("is_guest", 1), tab: "hot" },
      { rule: rule("is_guest", 0), tab: "following" },
    ],
    fallback: "latest",
  });
  expect(readSiteSettings(ctx).siteName).toBe("Forum");
});

test("migration 0065 leaves a home tab setting without Forums as it was, and a site that never saved one", () => {
  const { ctx, store, stored } = before();
  const setting = {
    rules: [{ rule: rule("is_guest", 1), tab: "media" as const }],
    fallback: "hot" as const,
  };
  store(setting);
  applyMigrations(ctx, 65, 65);
  expect(stored().homeTab).toEqual(setting);
  expect(readSiteSettings(ctx).homeTab).toEqual(setting);

  const fresh = before();
  applyMigrations(fresh.ctx, 65, 65);
  expect(readSiteSettings(fresh.ctx).homeTab).toEqual({ rules: [], fallback: "latest" });
});

test("migration 0065 puts What's new in Profile's place on the phone bar and points the header and footer at the new pages", () => {
  const { ctx, rows } = before();
  const [profile] = rows("builtin = 'mobile.profile'");
  const [forums] = rows("builtin = 'header.forums'");
  applyMigrations(ctx, 65, 65);

  expect(rows("builtin IN ('mobile.profile', 'header.forums')")).toEqual([]);
  const mobile = rows("location = 'mobile'");
  expect(mobile.map((row) => [row.builtin, row.title, row.target, row.audience])).toEqual([
    ["mobile.home", "Home", "/", "everyone"],
    ["mobile.novedades", "What's new", "/novedades", "everyone"],
    ["mobile.messages", "Messages", "/conversations", "members"],
    ["mobile.alerts", "Alerts", "/notifications", "members"],
    ["mobile.login", "Log in", "/login", "guests"],
  ]);
  expect(mobile[1]!.id).toBe(profile!.id);
  const header = rows("location = 'header'");
  expect(header.slice(0, 2).map((row) => [row.id, row.builtin, row.title, row.target])).toEqual([
    [header[0]!.id, "header.home", "Forums", "/"],
    [forums!.id, "header.novedades", "What's new", "/novedades"],
  ]);
  expect(rows("builtin = 'footer.community.forums'")[0]).toMatchObject({
    title: "Forums",
    target: "/",
  });
});

test("migration 0065 keeps the title an administrator gave Home, and replaces the old Forums entry and Profile whatever was done to them", () => {
  const { ctx, rows } = before();
  const [profile] = rows("builtin = 'mobile.profile'");
  ctx.sqlite.run("UPDATE navigation_entries SET title = 'Start' WHERE builtin = 'header.home'");
  ctx.sqlite.run(
    "UPDATE navigation_entries SET title = 'Boards', target = '/forums?tab=2' WHERE builtin = 'header.forums'",
  );
  ctx.sqlite.run(
    "UPDATE navigation_entries SET target = '/pages/about' WHERE builtin = 'footer.community.forums'",
  );
  ctx.sqlite
    .prepare(
      "UPDATE navigation_entries SET title = 'Me', is_enabled = 0, audience = 'permission', permission = 'shop.buy', icon = 'star' WHERE id = ?1",
    )
    .run(profile!.id);
  ctx.sqlite
    .prepare(
      "INSERT INTO navigation_entries (location, parent_id, title, target, position, created_at, updated_at) VALUES ('mobile', ?1, 'Under', '/pages/under', 0, 0, 0)",
    )
    .run(profile!.id);
  applyMigrations(ctx, 65, 65);

  expect(rows("builtin = 'header.home'")[0]).toMatchObject({ title: "Start", target: "/" });
  // The old Forums entry leads to another page now: an administrator's title for it would be wrong.
  expect(rows("builtin = 'header.novedades'")[0]).toMatchObject({
    title: "What's new",
    target: "/novedades",
  });
  expect(rows("builtin = 'footer.community.forums'")[0]!.target).toBe("/pages/about");
  expect(rows(`id = ${profile!.id}`)[0]).toMatchObject({
    builtin: "mobile.novedades",
    title: "What's new",
    target: "/novedades",
    position: 1,
    is_enabled: 1,
    audience: "everyone",
    permission: null,
    icon: null,
  });
  expect(rows("title = 'Under'")).toEqual([]);
});

const mobileOrder = (rows: (where: string) => Row[]) =>
  rows("location = 'mobile' AND parent_id IS NULL").map((row) => row.builtin ?? row.title);

test("migration 0065 puts What's new right after Home however the phone bar is numbered", () => {
  const { ctx, rows } = before();
  const renumber = ctx.sqlite.prepare(
    "UPDATE navigation_entries SET position = ?2 WHERE builtin = ?1",
  );
  for (const [builtin, position] of [
    ["mobile.home", 10],
    ["mobile.messages", 20],
    ["mobile.alerts", 30],
    ["mobile.profile", 40],
    ["mobile.login", 50],
  ] as const)
    renumber.run(builtin, position);
  // An entry an administrator put before Home stays there.
  ctx.sqlite.run(
    "INSERT INTO navigation_entries (location, title, target, position, created_at, updated_at) VALUES ('mobile', 'Rules', '/rules', 5, 0, 0)",
  );
  applyMigrations(ctx, 65, 65);

  expect(mobileOrder(rows)).toEqual([
    "Rules",
    "mobile.home",
    "mobile.novedades",
    "mobile.messages",
    "mobile.alerts",
    "mobile.login",
  ]);
  expect(rows("builtin = 'mobile.novedades'")[0]!.position).toBe(11);
  expect(rows("builtin = 'mobile.messages'")[0]!.position).toBe(21);
  expect(rows("title = 'Rules'")[0]!.position).toBe(5);
});

test("migration 0065 without a Home entry leaves the bar's numbering alone and What's new in Profile's place", () => {
  const { ctx, rows } = before();
  ctx.sqlite.run("DELETE FROM navigation_entries WHERE builtin = 'mobile.home'");
  const [profile] = rows("builtin = 'mobile.profile'");
  applyMigrations(ctx, 65, 65);

  expect(rows("builtin = 'mobile.novedades'")[0]!.position).toBe(profile!.position);
  expect(mobileOrder(rows)).toEqual([
    "mobile.messages",
    "mobile.alerts",
    "mobile.novedades",
    "mobile.login",
  ]);
});
