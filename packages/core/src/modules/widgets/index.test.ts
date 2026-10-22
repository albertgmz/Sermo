import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createTestContext,
  expectNoTableScan,
  insertUser,
  tokenActor,
  userActor,
} from "@sermo/core/testing";
import { GUEST } from "../../actor";
import type { Ctx } from "../../context";
import { ConflictError, ForbiddenError, UnauthenticatedError, ValidationError } from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { customMember } from "../permissions/group-fixture";
import { widgetsSql } from "./index";

const run = (ctx: Ctx, name: string, actor: Parameters<typeof execute>[2], input: object = {}) =>
  // biome-ignore lint/suspicious/noExplicitAny: operations are called by name, their output is loosely typed
  execute(ctx, getOperation(name), actor, input) as Promise<any>;

const rule = (...conditions: object[]) => ({ match: "all", conditions });
const GUESTS = rule({ criterion: "is_guest", value: 1 });
const MEMBERS = rule({ criterion: "is_guest", value: 0 });

function setup() {
  const ctx = createTestContext();
  const admin = userActor(insertUser(ctx, { groupId: 4 }));
  const moderator = userActor(insertUser(ctx, { groupId: 3 }));
  const member = userActor(insertUser(ctx));
  const clear = () => ctx.sqlite.exec("DELETE FROM widgets");
  const create = (input: object, actor = admin) => run(ctx, "widgets.create", actor, input);
  const current = async (page: string, actor: Parameters<typeof execute>[2] = GUEST) =>
    (await run(ctx, "widgets.current", actor, { page })).items as {
      id: number;
      position: string;
      type: string;
      title: string | null;
      phones: boolean;
      options: Record<string, unknown>;
      bodyHtml?: string;
    }[];
  const ids = async (page: string, actor: Parameters<typeof execute>[2] = GUEST) =>
    (await current(page, actor)).map((item) => item.id);
  return { ctx, admin, moderator, member, clear, create, current, ids };
}

describe("the default widgets", () => {
  test("a new site draws what the pages draw today: statistics (off) on the forum list, featured threads and the four side blocks on the feed page", async () => {
    const { ctx, admin, current } = setup();
    const draws = async (page: string) =>
      (await current(page)).map((item) => [item.position, item.type, item.options]);
    expect(await draws("novedades")).toEqual([
      ["novedades_above", "featured", {}],
      ["novedades_sidebar", "rankedThreads", { by: "mostReacted", limit: 5 }],
      ["novedades_sidebar", "rankedThreads", { by: "latestThreads", limit: 5 }],
      ["novedades_sidebar", "suggestedMembers", { limit: 4 }],
      ["novedades_sidebar", "forumLinks", { limit: 6 }],
    ]);
    // The forum statistics are there, off while the old setting is off, and nothing else is.
    const all = await run(ctx, "widgets.list", admin);
    const stats = all.items.filter((item: { type: string }) => item.type === "forumStats");
    expect(stats).toMatchObject([
      { position: "forum_list_above", isEnabled: false, displayOrder: 0 },
    ]);
    expect(await draws("home")).toEqual([]);
    expect(await draws("forum")).toEqual([]);
    expect(await draws("members")).toEqual([]);
    expect(all.items.every((item: { position: string }) => item.position !== "overview_top")).toBe(
      true,
    );
  });

  test("the seed follows the old statistics setting and adds nothing when run again", () => {
    const { ctx, clear } = setup();
    const sql = readFileSync(join(import.meta.dir, "../../../drizzle/0066_widgets.sql"), "utf8")
      .split("--> statement-breakpoint")
      .find((statement) => statement.includes("INSERT INTO `widgets`"))!;
    const enabledStats = () =>
      ctx.sqlite
        .prepare<{ is_enabled: number }, []>(
          "SELECT is_enabled FROM widgets WHERE type = 'forumStats'",
        )
        .get()!.is_enabled;
    const count = () =>
      ctx.sqlite.prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM widgets").get()!.n;
    for (const [setting, expected] of [
      [true, 1],
      [false, 0],
    ] as const) {
      clear();
      ctx.sqlite
        .prepare(
          "INSERT INTO site_settings (key, value, updated_at) VALUES ('configuration', ?1, 0) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        )
        .run(JSON.stringify({ forumStatsEnabled: setting }));
      ctx.sqlite.exec(sql);
      expect(count()).toBe(6);
      expect(enabledStats()).toBe(expected);
      ctx.sqlite.exec(sql);
      expect(count()).toBe(6);
    }
    clear();
    ctx.sqlite.exec("DELETE FROM site_settings WHERE key = 'configuration'");
    ctx.sqlite.exec(sql);
    expect(enabledStats()).toBe(0);
  });
});

describe("widgets.current", () => {
  test("a page draws its own positions and the global ones, in drawing order", async () => {
    const { clear, create, current } = setup();
    clear();
    const make = (position: string, type = "featured") => create({ position, type });
    await make("sidebar_bottom");
    await make("forum_list_sidebar");
    await make("overview_top");
    await make("novedades_above");
    await make("novedades_sidebar");
    await make("forum_view_sidebar");
    await make("members_sidenav");
    await make("sidebar_top");
    await make("overview_top", "birthdays");
    const positions = async (page: string) => (await current(page)).map((i) => i.position);
    expect(await positions("home")).toEqual([
      "overview_top",
      "overview_top",
      "forum_list_sidebar",
      "sidebar_top",
      "sidebar_bottom",
    ]);
    expect((await current("home"))[1]!.type).toBe("birthdays");
    expect(await positions("novedades")).toEqual([
      "overview_top",
      "overview_top",
      "novedades_above",
      "novedades_sidebar",
      "sidebar_top",
      "sidebar_bottom",
    ]);
    expect(await positions("forum")).toEqual([
      "forum_view_sidebar",
      "sidebar_top",
      "sidebar_bottom",
    ]);
    expect(await positions("members")).toEqual([
      "members_sidenav",
      "sidebar_top",
      "sidebar_bottom",
    ]);
  });

  test("disabled widgets are left out; the rule decides per viewer", async () => {
    const { clear, create, ids, member } = setup();
    clear();
    const everyone = await create({ position: "overview_top", type: "featured" });
    const off = await create({ position: "overview_top", type: "featured", isEnabled: false });
    const guestsOnly = await create({ position: "overview_top", type: "featured", rule: GUESTS });
    const membersOnly = await create({ position: "overview_top", type: "featured", rule: MEMBERS });
    expect(await ids("home")).toEqual([everyone.id, guestsOnly.id]);
    expect(await ids("home", member)).toEqual([everyone.id, membersOnly.id]);
    expect(await ids("home")).not.toContain(off.id);
  });

  test("a guest is not given the types about the signed-in member, and a member is", async () => {
    const { clear, create, ids, member } = setup();
    clear();
    const card = await create({ position: "forum_list_sidebar", type: "visitorCard" });
    const link = await create({ position: "forum_list_sidebar", type: "referralLink" });
    const birthdays = await create({ position: "forum_list_sidebar", type: "birthdays" });
    expect(await ids("home")).toEqual([birthdays.id]);
    expect(await ids("home", member)).toEqual([card.id, link.id, birthdays.id]);
  });

  test("a new visitor card is off on phones and the other new types are on", async () => {
    const { clear, create, current, member } = setup();
    clear();
    for (const type of [
      "visitorCard",
      "birthdays",
      "topReferrers",
      "referralLink",
      "monthStandings",
    ])
      await create({ position: "forum_list_sidebar", type });
    const phones = Object.fromEntries(
      (await current("home", member)).map((item) => [item.type, item.phones]),
    );
    expect(phones).toEqual({
      visitorCard: false,
      birthdays: true,
      topReferrers: true,
      referralLink: true,
      monthStandings: true,
    });
  });

  test("a visitor is told what to draw and nothing administrative", async () => {
    const { clear, create, current } = setup();
    clear();
    await create({
      position: "overview_top",
      type: "text",
      title: "Welcome",
      options: { body: "Hello [B]there[/B]" },
      rule: GUESTS,
    });
    const [item] = await current("home");
    expect(item).toEqual({
      id: expect.any(Number),
      position: "overview_top",
      type: "text",
      title: "Welcome",
      phones: true,
      options: { body: "Hello [B]there[/B]" },
      bodyHtml: expect.stringContaining("<strong>there</strong>"),
    });
  });

  test("a write is seen at once; between writes the list comes from the cache", async () => {
    const { ctx, clear, create, ids, admin } = setup();
    clear();
    const first = await create({ position: "overview_top", type: "featured" });
    expect(await ids("home")).toEqual([first.id]);
    // A change that bypasses the operations does not show: the page reads the cached list.
    ctx.sqlite.exec("UPDATE widgets SET is_enabled = 0");
    expect(await ids("home")).toEqual([first.id]);
    ctx.sqlite.exec("UPDATE widgets SET is_enabled = 1");
    const second = await create({ position: "overview_top", type: "featured" });
    expect(await ids("home")).toEqual([first.id, second.id]);
    await run(ctx, "widgets.update", admin, {
      widgetId: first.id,
      type: "featured",
      position: "overview_top",
      title: null,
      phones: true,
      isEnabled: false,
      rule: rule(),
    });
    expect(await ids("home")).toEqual([second.id]);
    await run(ctx, "widgets.delete", admin, { widgetId: second.id });
    expect(await ids("home")).toEqual([]);
  });
});

describe("widgets management", () => {
  test("guests, members, moderators and other admin areas are refused before the input is read", async () => {
    const { ctx, admin, moderator, member, create } = setup();
    const made = await create({ position: "overview_top", type: "featured" });
    const other = customMember(ctx, ["admin.navigation", "admin.settings"]).actor;
    const names = [
      "widgets.list",
      "widgets.create",
      "widgets.update",
      "widgets.duplicate",
      "widgets.reorder",
      "widgets.delete",
    ];
    for (const name of names) {
      // The input is not valid for any of them: the refusal comes first.
      const input = { widgetId: "x", type: "nothing", position: 3 };
      await expect(run(ctx, name, GUEST, input)).rejects.toBeInstanceOf(UnauthenticatedError);
      await expect(run(ctx, name, member, input)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(run(ctx, name, moderator, input)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(run(ctx, name, other, input)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(
      (await run(ctx, "widgets.list", admin)).items.some((w: { id: number }) => w.id === made.id),
    ).toBe(true);
  });

  test("the group holding admin.widgets manages them", async () => {
    const { ctx } = setup();
    const holder = customMember(ctx, ["admin.widgets"]).actor;
    const made = await run(ctx, "widgets.create", holder, {
      position: "overview_top",
      type: "featured",
    });
    await run(ctx, "widgets.delete", holder, { widgetId: made.id });
    const token = tokenActor(insertUser(ctx, { groupId: 4 }));
    expect((await run(ctx, "widgets.list", token)).items.length).toBeGreaterThan(0);
  });

  test("create appends to its position with the options' defaults and the phone default of the type", async () => {
    const { clear, create } = setup();
    clear();
    const first = await create({ position: "forum_list_sidebar", type: "birthdays" });
    expect(first).toMatchObject({
      position: "forum_list_sidebar",
      displayOrder: 0,
      title: null,
      phones: true,
      isEnabled: true,
      rule: rule(),
      options: { limit: 12 },
    });
    const card = await create({ position: "forum_list_sidebar", type: "visitorCard" });
    expect(card).toMatchObject({ displayOrder: 1, phones: false, options: {} });
    const shown = await create({
      position: "forum_list_sidebar",
      type: "visitorCard",
      phones: true,
      title: "  Me ",
    });
    expect(shown).toMatchObject({ displayOrder: 2, phones: true, title: "Me" });
    const elsewhere = await create({ position: "overview_top", type: "forumStats" });
    expect(elsewhere).toMatchObject({ displayOrder: 0, options: { limit: 10, topPosters: false } });
  });

  test("options are checked for the type", async () => {
    const { ctx, create } = setup();
    const bad: object[] = [
      { type: "birthdays", options: { limit: 51 } },
      { type: "birthdays", options: { limit: 0 } },
      { type: "birthdays", options: { limit: 2.5 } },
      { type: "birthdays", options: { limit: "5" } },
      { type: "birthdays", options: { made_up: 1 } },
      { type: "featured", options: { limit: 3 } },
      { type: "forumStats", options: { limit: 4 } },
      { type: "forumStats", options: { topPosters: "yes" } },
      { type: "rankedThreads", options: { by: "loudest" } },
      { type: "recentlyActive", options: { window: "1h" } },
      { type: "recentlyActive", options: { limit: 0 } },
      { type: "recentlyActive", options: { limit: 201 } },
      { type: "monthStandings", options: { limit: 11 } },
      { type: "text", options: {} },
      { type: "text", options: { body: "" } },
      { type: "text" },
      { type: "poll", options: {} },
      { type: "birthdays", position: "nowhere" },
      { type: "birthdays", title: "" },
      { type: "birthdays", title: "x".repeat(101) },
      { type: "birthdays", options: "no" },
    ];
    for (const input of bad)
      await expect(create({ position: "overview_top", ...input })).rejects.toBeInstanceOf(
        ValidationError,
      );
    const good = await create({
      position: "overview_top",
      type: "recentlyActive",
      options: { window: "15m" },
    });
    expect(good.options).toEqual({ window: "15m", limit: 50 });
    const capped = await create({
      position: "overview_top",
      type: "recentlyActive",
      options: { limit: 10 },
    });
    expect(capped.options).toEqual({ window: "24h", limit: 10 });
    expect(
      (await run(ctx, "widgets.list", userActor(insertUser(ctx, { groupId: 4 })))).items.length,
    ).toBeGreaterThan(0);
  });

  test("the rule must be valid and cheap to check", async () => {
    const { create } = setup();
    for (const bad of [
      rule({ criterion: "made_up", value: 1 }),
      rule({ criterion: "in_group", ids: [9999] }),
      rule({ criterion: "warning_points_below", value: 5 }),
    ])
      await expect(
        create({ position: "overview_top", type: "featured", rule: bad }),
      ).rejects.toBeInstanceOf(ValidationError);
    const fine = await create({
      position: "overview_top",
      type: "featured",
      rule: rule({ criterion: "post_count", value: 5 }),
    });
    expect(fine.rule).toEqual(rule({ criterion: "post_count", value: 5 }));
  });

  test("a stored option set is read with the defaults of keys added since", async () => {
    const { ctx, clear, admin, current } = setup();
    clear();
    ctx.sqlite.exec(
      `INSERT INTO widgets (position, type, display_order, options, created_at, updated_at) VALUES ('overview_top', 'forumStats', 0, '{"topPosters":true,"gone":1}', 1, 1), ('overview_top', 'monthStandings', 1, '{}', 1, 1)`,
    );
    expect((await current("home")).map((item) => item.options)).toEqual([
      { limit: 10, topPosters: true },
      { limit: 5, picker: true },
    ]);
    const listed = (await run(ctx, "widgets.list", admin)).items;
    expect(listed[0].options).toEqual({ limit: 10, topPosters: true });
  });

  test("a row whose options no longer parse reads as the defaults and breaks no page", async () => {
    const { ctx, clear, create, admin, current } = setup();
    clear();
    const fine = await create({ position: "overview_top", type: "featured" });
    ctx.sqlite.exec(
      `INSERT INTO widgets (position, type, display_order, options, created_at, updated_at) VALUES ('overview_top', 'birthdays', 1, '{"limit":999}', 1, 1), ('overview_top', 'text', 2, '{"body":"kept","bodyHtml":"<p>kept</p>","made_up":1}', 1, 1), ('overview_top', 'text', 3, '{}', 1, 1), ('overview_top', 'forumLinks', 4, 'not json', 1, 1), ('overview_top', 'topReferrers', 5, '[1]', 1, 1)`,
    );
    ctx.sqlite.exec("UPDATE cache_versions SET version = version + 1 WHERE key = 'widgets'");
    const shown = await current("home");
    expect(shown.map((item) => item.id)[0]).toBe(fine.id);
    expect(shown.map((item) => item.options)).toEqual([
      {},
      { limit: 12 },
      { body: "kept" },
      { limit: 6 },
      { limit: 5 },
    ]);
    const listed = (await run(ctx, "widgets.list", admin)).items;
    // The panel still lists the text row that has no body, so it can be fixed or deleted.
    expect(listed.map((item: { options: object }) => item.options)).toEqual([
      {},
      { limit: 12 },
      { body: "kept" },
      { body: "?" },
      { limit: 6 },
      { limit: 5 },
    ]);
  });

  test("the site holds a bounded number of widgets", async () => {
    const { ctx, clear, create, admin } = setup();
    clear();
    ctx.sqlite.exec(
      `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 99) INSERT INTO widgets (position, type, display_order, created_at, updated_at) SELECT 'overview_top', 'featured', i, 1, 1 FROM n`,
    );
    await expect(create({ position: "overview_top", type: "featured" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    const [first] = (await run(ctx, "widgets.list", admin)).items;
    await expect(
      run(ctx, "widgets.duplicate", admin, { widgetId: first.id }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("update replaces the fields, keeps the type and moves to the end when the position changes", async () => {
    const { ctx, clear, create, admin, ids, current } = setup();
    clear();
    const a = await create({ position: "forum_list_sidebar", type: "birthdays" });
    const b = await create({ position: "forum_list_sidebar", type: "birthdays" });
    const c = await create({ position: "overview_top", type: "birthdays" });
    const fields = {
      widgetId: a.id,
      type: "birthdays",
      position: "forum_list_sidebar",
      title: "Today",
      phones: false,
      isEnabled: true,
      rule: MEMBERS,
      options: { limit: 3 },
    };
    const same = await run(ctx, "widgets.update", admin, fields);
    expect(same).toMatchObject({
      displayOrder: 0,
      title: "Today",
      phones: false,
      options: { limit: 3 },
    });
    expect(same.rule).toEqual(MEMBERS);
    // The page is read before the move, so the move shows only if the write dropped the cache.
    const positionOfA = async () =>
      (await current("home", admin)).find((item) => item.id === a.id)?.position;
    expect(await positionOfA()).toBe("forum_list_sidebar");
    const moved = await run(ctx, "widgets.update", admin, { ...fields, position: "overview_top" });
    expect(moved).toMatchObject({ position: "overview_top", displayOrder: 1 });
    expect(await positionOfA()).toBe("overview_top");
    expect(await ids("home", admin)).toEqual([c.id, a.id, b.id]);
    await expect(
      run(ctx, "widgets.update", admin, { ...fields, type: "featured", options: {} }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      run(ctx, "widgets.update", admin, { ...fields, widgetId: 99999 }),
    ).rejects.toMatchObject({ name: "NotFoundError" });
    await expect(
      run(ctx, "widgets.update", admin, { ...fields, options: { limit: 99 } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test("a text widget is rendered when written and again when edited", async () => {
    const { ctx, clear, create, admin } = setup();
    clear();
    const made = await create({
      position: "overview_top",
      type: "text",
      options: { body: "[I]one[/I]" },
    });
    expect(made.bodyHtml).toContain("<em>one</em>");
    expect(made.options).toEqual({ body: "[I]one[/I]" });
    const edited = await run(ctx, "widgets.update", admin, {
      widgetId: made.id,
      type: "text",
      position: "overview_top",
      title: null,
      phones: true,
      isEnabled: true,
      rule: rule(),
      options: { body: "[B]two[/B]" },
    });
    expect(edited.bodyHtml).toContain("<strong>two</strong>");
    expect(edited.bodyHtml).not.toContain("one");
  });

  test("duplicate copies a widget to the end of a position", async () => {
    const { ctx, clear, create, admin, ids } = setup();
    clear();
    const original = await create({
      position: "forum_list_sidebar",
      type: "topReferrers",
      title: "Top",
      options: { limit: 7 },
      phones: false,
      rule: MEMBERS,
    });
    const other = await create({ position: "forum_list_sidebar", type: "featured" });
    expect(await ids("home", admin)).toEqual([original.id, other.id]);
    const copy = await run(ctx, "widgets.duplicate", admin, { widgetId: original.id });
    expect(copy.id).not.toBe(original.id);
    expect(copy).toMatchObject({
      position: "forum_list_sidebar",
      displayOrder: 2,
      type: "topReferrers",
      title: "Top",
      phones: false,
      isEnabled: true,
      options: { limit: 7 },
    });
    expect(copy.rule).toEqual(MEMBERS);
    expect(await ids("home", admin)).toEqual([original.id, other.id, copy.id]);
    const elsewhere = await run(ctx, "widgets.duplicate", admin, {
      widgetId: original.id,
      position: "novedades_sidebar",
    });
    expect(elsewhere).toMatchObject({ position: "novedades_sidebar", displayOrder: 0 });
    expect(await ids("home", admin)).toEqual([original.id, other.id, copy.id]);
    await expect(run(ctx, "widgets.duplicate", admin, { widgetId: 99999 })).rejects.toMatchObject({
      name: "NotFoundError",
    });
  });

  test("reorder takes the whole position, once each, and changes nothing otherwise", async () => {
    const { ctx, clear, create, admin, ids } = setup();
    clear();
    const [a, b, c] = [
      await create({ position: "overview_top", type: "featured" }),
      await create({ position: "overview_top", type: "birthdays" }),
      await create({ position: "overview_top", type: "siteTotals" }),
    ];
    const elsewhere = await create({ position: "overview_bottom", type: "featured" });
    expect(await ids("home")).toEqual([a.id, b.id, c.id, elsewhere.id]);
    await run(ctx, "widgets.reorder", admin, { position: "overview_top", ids: [c.id, a.id, b.id] });
    expect(await ids("home")).toEqual([c.id, a.id, b.id, elsewhere.id]);
    for (const bad of [
      [c.id, a.id],
      [c.id, a.id, b.id, elsewhere.id],
      [c.id, a.id, a.id],
      [c.id, a.id, 99999],
      [],
    ])
      await expect(
        run(ctx, "widgets.reorder", admin, { position: "overview_top", ids: bad }),
      ).rejects.toBeInstanceOf(ValidationError);
    expect(await ids("home")).toEqual([c.id, a.id, b.id, elsewhere.id]);
    await run(ctx, "widgets.reorder", admin, { position: "overview_bottom", ids: [elsewhere.id] });
    await run(ctx, "widgets.reorder", admin, { position: "sidebar_top", ids: [] });
  });

  test("delete removes a widget; a second delete finds none", async () => {
    const { ctx, clear, create, admin } = setup();
    clear();
    const made = await create({ position: "overview_top", type: "featured" });
    await run(ctx, "widgets.delete", admin, { widgetId: made.id });
    expect((await run(ctx, "widgets.list", admin)).items).toEqual([]);
    await expect(run(ctx, "widgets.delete", admin, { widgetId: made.id })).rejects.toMatchObject({
      name: "NotFoundError",
    });
  });

  test("list runs in drawing order, disabled widgets included", async () => {
    const { ctx, clear, create, admin } = setup();
    clear();
    const late = await create({ position: "sidebar_bottom", type: "featured" });
    const off = await create({ position: "overview_top", type: "featured", isEnabled: false });
    const on = await create({ position: "overview_top", type: "featured" });
    const listed = (await run(ctx, "widgets.list", admin)).items.map((w: { id: number }) => w.id);
    expect(listed).toEqual([off.id, on.id, late.id]);
  });
});

describe("the queries behind the widgets", () => {
  test("a position's lookups use the position index", () => {
    const { ctx } = setup();
    expectNoTableScan(ctx, widgetsSql.inPosition, ["overview_top"]);
    expectNoTableScan(ctx, widgetsSql.one, [1]);
    expectNoTableScan(ctx, widgetsSql.delete, [1]);
    expectNoTableScan(
      ctx,
      "SELECT COALESCE(MAX(display_order), -1) + 1 FROM widgets WHERE position = ?1",
      ["overview_top"],
    );
  });
});
