import { describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { MEMBER_SORTS } from "../../contracts/members";
import { ForbiddenError, ValidationError } from "../../errors";
import { encodeCursor } from "../../pagination";
import { expectNoTableScan, userActor } from "../../testing";
import { birthdaySql, listSql, staffBanSql, staffSql } from "./directory";
import { type World, world } from "./fixtures.test";

const COLUMN = {
  posts: "post_count",
  reactions: "reaction_score",
  level: "award_xp",
  credits: "credits",
  awards: "award_count",
  referrals: "referral_count",
} as const;

type Item = { card: { id: number }; postCount: number };
const list = (w: World, input: object, actor: object = w.memberActor) =>
  w.call("users.list", actor, input) as Promise<{ items: Item[]; nextCursor: string | null }>;

async function walk(w: World, sort: string, limit: number) {
  const ids: number[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 200; pages++) {
    const page = await list(w, { sort, limit, cursor });
    ids.push(...page.items.map((item) => item.card.id));
    if (page.nextCursor === null) return ids;
    cursor = page.nextCursor;
  }
  throw new Error("the walk did not end");
}

/** Members with repeated values so every sort has ties, plus the three of the fixture. */
function populated() {
  const w = world();
  const values = [5, 5, 5, 3, 3, 1, 0, 9, 9, 2];
  const users = values.map((value) => {
    const user = w.user();
    w.set(user.id, {
      post_count: value,
      reaction_score: value,
      award_xp: Math.max(value, 0),
      credits: value - 4,
      award_count: Math.max(value, 0),
      referral_count: Math.max(value, 0),
    });
    return { ...user, value };
  });
  return { w, users };
}

describe("users.list", () => {
  for (const sort of MEMBER_SORTS.filter((name) => name !== "newest"))
    test(`sort ${sort}: highest first, older account first on ties, across pages`, async () => {
      const { w } = populated();
      const column = COLUMN[sort as keyof typeof COLUMN];
      // Credits include negative balances; the three fixture members hold 0.
      const expected = w.ctx.sqlite
        .prepare<{ id: number }, []>(`SELECT id FROM users ORDER BY ${column} DESC, id ASC`)
        .all()
        .map((row) => row.id);
      for (const limit of [1, 3, 100]) expect(await walk(w, sort, limit)).toEqual(expected);
      const first = await list(w, { sort, limit: 4 });
      expect(first.items.map((item) => item.card.id)).toEqual(expected.slice(0, 4));
    });

  for (const sort of MEMBER_SORTS.filter((name) => name !== "newest"))
    test(`ranked ${sort}: only members above zero, highest first, across pages`, async () => {
      const { w } = populated();
      const column = COLUMN[sort as keyof typeof COLUMN];
      const expected = w.ctx.sqlite
        .prepare<{ id: number }, []>(
          `SELECT id FROM users WHERE ${column} > 0 ORDER BY ${column} DESC, id ASC`,
        )
        .all()
        .map((row) => row.id);
      expect(expected.length).toBeGreaterThan(0);
      for (const limit of [1, 3, 100]) {
        const ids: number[] = [];
        let cursor: string | undefined;
        do {
          const page = await list(w, { sort, ranked: true, limit, cursor });
          ids.push(...page.items.map((item) => item.card.id));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        expect(ids).toEqual(expected);
      }
    });

  test("ranked: a cursor on a zero figure does not walk into the members who scored nothing", async () => {
    const { w } = populated();
    const cursor = encodeCursor([0, 1]);
    const page = await list(w, { sort: "posts", ranked: true, limit: 50, cursor });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect((await list(w, { sort: "posts", limit: 50, cursor })).items.length).toBeGreaterThan(0);
  });

  test("ranked: nobody has scored, so the ranking is empty while the directory is not", async () => {
    const w = world();
    expect((await list(w, { sort: "credits", ranked: true })).items).toEqual([]);
    expect((await list(w, { sort: "credits" })).items.length).toBeGreaterThan(0);
  });

  test("ranked: negative balances, banned, erased and private members are left out", async () => {
    const { w, users } = populated();
    w.set(users[7]!.id, { banned_permanently: 1 });
    w.set(users[8]!.id, { erased_at: w.ctx.now() });
    w.set(users[0]!.id, { profile_view_privacy: "self" });
    const ids = (actor: object) =>
      list(w, { sort: "credits", ranked: true, limit: 100 }, actor).then((page) =>
        page.items.map((item) => item.card.id),
      );
    const seen = await ids(GUEST);
    for (const gone of [7, 8, 0]) expect(seen).not.toContain(users[gone]!.id);
    // Credits are value - 4: only the members above 4 hold a positive balance.
    expect(seen).toEqual(
      users
        .filter((user, index) => user.value > 4 && ![7, 8, 0].includes(index))
        .sort((a, b) => b.value - a.value || a.id - b.id)
        .map((user) => user.id),
    );
    expect(await ids(userActor(users[0]!))).toContain(users[0]!.id);
  });

  test("the plain directory goes by the ban alone: an erased mark without a ban does not hide a member", async () => {
    const { w, users } = populated();
    w.set(users[8]!.id, { erased_at: w.ctx.now() });
    expect(await walk(w, "newest", 5)).toContain(users[8]!.id);
    expect(await walk(w, "credits", 5)).toContain(users[8]!.id);
  });

  test("newest: the most recently registered first", async () => {
    const { w, users } = populated();
    const expected = [w.admin, w.moderator, w.member, ...users].map((user) => user.id).reverse();
    expect(await walk(w, "newest", 4)).toEqual(expected);
    expect((await list(w, {})).items[0]?.card.id).toBe(expected[0]!);
  });

  test("an item carries the card and the counters", async () => {
    const { w, users } = populated();
    const top = users[7]!;
    w.set(top.id, { credits: 12, referral_count: 2 });
    const page = (await list(w, { sort: "posts", limit: 1 })).items[0] as unknown as {
      card: { id: number; username: string };
      createdAt: string;
      postCount: number;
      reactionScore: number;
      credits: number;
      referralCount: number;
      awardCount: number;
      awardXp: number;
    };
    expect(page.card).toMatchObject({ id: top.id, username: top.username });
    expect(page).toMatchObject({ postCount: 9, reactionScore: 9, credits: 12, referralCount: 2 });
    expect(page.createdAt).toMatch(/^\d{4}-/);
  });

  test("banned members are left out, expired bans are not", async () => {
    const { w, users } = populated();
    w.set(users[0]!.id, { banned_permanently: 1 });
    w.set(users[7]!.id, { banned_until: w.ctx.now() + 86_400_000 });
    w.set(users[8]!.id, { banned_until: w.ctx.now() - 1000 });
    for (const sort of ["newest", "posts", "level"]) {
      const ids = await walk(w, sort, 3);
      expect(ids).not.toContain(users[0]!.id);
      expect(ids).not.toContain(users[7]!.id);
      expect(ids).toContain(users[8]!.id);
      expect(ids).toHaveLength(users.length + 3 - 2);
    }
  });

  test("a page can be short while there is more: the scan is bounded", async () => {
    const w = world();
    const early = w.user();
    for (let i = 0; i < 430; i++) {
      const user = w.user();
      w.set(user.id, { banned_permanently: 1 });
    }
    const page = await list(w, { sort: "newest", limit: 5 });
    expect(page.items).toEqual([]);
    expect(page.nextCursor).not.toBeNull();
    const rest = await walk(w, "newest", 5);
    expect(rest).toContain(early.id);
    expect(rest).toContain(w.member.id);
  });

  test("a bad cursor is a validation error", async () => {
    const w = world();
    await expect(list(w, { sort: "posts", cursor: "not-a-cursor" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("guests and members may list, a viewer without profile.view may not", async () => {
    const w = world();
    expect((await list(w, {}, GUEST)).items.length).toBeGreaterThan(0);
    const group = (await w.call("groups.create", w.adminActor, { title: "Blind", rank: 1 })).id;
    await w.call("permissions.set", w.adminActor, {
      groupId: group,
      entries: [{ permission: "profile.view", value: "never" }],
    });
    const blind = w.user({ groupId: group });
    const actor = { kind: "user", userId: blind.id, groupId: group, sessionId: 0 };
    await expect(list(w, {}, actor)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.call("users.staff", actor, {})).rejects.toBeInstanceOf(ForbiddenError);
    await expect(w.call("users.birthdays", actor, {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("every sort reads its index", () => {
    const w = world();
    expectNoTableScan(w.ctx, listSql.newest, [100, 21]);
    for (const sort of MEMBER_SORTS.filter((name) => name !== "newest")) {
      const s = sort as keyof typeof COLUMN;
      expectNoTableScan(w.ctx, listSql.tie(s), [3, 5, 21]);
      expectNoTableScan(w.ctx, listSql.below(s), [3, 21, 0]);
    }
  });
});

describe("users.staff", () => {
  test("the built-in staff groups are named in the site's language", async () => {
    const w = world();
    await w.call("settings.update", w.adminActor, { defaultLanguage: "es" });
    const result = await w.call("users.staff", GUEST, {});
    const admin = result.items.find(
      (item: { card: { id: number } }) => item.card.id === w.admin.id,
    );
    expect(admin.groups).toEqual(["Administrador"]);
  });

  test("members of staff groups by every route, highest rank first, then username", async () => {
    const w = world();
    const lead = w.group({ title: "Lead", rank: 60 });
    const helper = w.group({ title: "Helper", rank: 20 });
    const plain = w.group({ title: "Plain", rank: 90 });
    w.ctx.sqlite.run(`UPDATE groups SET is_staff = 1 WHERE id IN (${lead}, ${helper})`);
    const byHand = w.user({ username: "Zed" });
    const promoted = w.user({ username: "Amy" });
    const bought = w.user({ username: "Bob" });
    const primary = w.user({ groupId: helper, username: "Cat" });
    const both = w.user({ groupId: helper, username: "Dan" });
    const outsider = w.user({ groupId: plain });
    w.ctx.sqlite.run("PRAGMA foreign_keys = OFF");
    w.ctx.sqlite.run(
      `INSERT INTO user_groups (user_id, group_id, created_at) VALUES (${byHand.id}, ${helper}, 0), (${both.id}, ${lead}, 0)`,
    );
    w.ctx.sqlite.run(
      `INSERT INTO user_group_grants (user_id, promotion_id, group_id, created_at) VALUES (${promoted.id}, 1, ${helper}, 0)`,
    );
    w.ctx.sqlite.run(
      `INSERT INTO shop_group_grants (user_id, inventory_id, group_id, created_at) VALUES (${bought.id}, 1, ${helper}, 0)`,
    );
    const result = await w.call("users.staff", GUEST, {});
    const names = result.items.map((item: { card: { username: string } }) => item.card.username);
    // Administrators (100) and the moderator (50) are staff by default; then Lead (60) holders.
    expect(names).toEqual([
      w.admin.username,
      "Dan",
      w.moderator.username,
      "Amy",
      "Bob",
      "Cat",
      "Zed",
    ]);
    expect(names).not.toContain(outsider.username);
    const dan = result.items.find((item: { card: { id: number } }) => item.card.id === both.id);
    expect(dan.groups).toEqual(["Lead", "Helper"]);
    expect(result.items[0].groups).toEqual(["Administrator"]);
    expect(primary.id).toBeGreaterThan(0);
  });

  test("banned staff are left out, an expired ban is not", async () => {
    const w = world();
    const names = async () =>
      (await w.call("users.staff", GUEST, {})).items.map(
        (item: { card: { id: number } }) => item.card.id,
      );
    expect(await names()).toContain(w.moderator.id);
    w.set(w.moderator.id, { banned_until: w.ctx.now() + 86_400_000 });
    expect(await names()).not.toContain(w.moderator.id);
    w.set(w.moderator.id, { banned_until: w.ctx.now() - 1000 });
    expect(await names()).toContain(w.moderator.id);
    w.set(w.admin.id, { banned_permanently: 1 });
    expect(await names()).toEqual([w.moderator.id]);
  });

  test("a group that stops being staff drops out", async () => {
    const w = world();
    const group = (
      await w.call("groups.create", w.adminActor, { title: "Crew", rank: 5, isStaff: true })
    ).id;
    const member = w.user({ groupId: group });
    const ids = async () =>
      (await w.call("users.staff", w.memberActor, {})).items.map(
        (item: { card: { id: number } }) => item.card.id,
      );
    expect(await ids()).toContain(member.id);
    await w.call("groups.update", w.adminActor, { groupId: group, isStaff: false });
    expect(await ids()).not.toContain(member.id);
  });

  test("at most 200 members", async () => {
    const w = world();
    for (let i = 0; i < 205; i++) w.user({ groupId: 3 });
    const result = await w.call("users.staff", w.memberActor, {});
    expect(result.items).toHaveLength(200);
    expect(result.items[0].groups).toEqual(["Administrator"]);
  });

  test("the queries read indexes", () => {
    const w = world();
    expectNoTableScan(w.ctx, staffSql.groups, []);
    for (const source of [
      "users",
      "user_groups",
      "user_group_grants",
      "shop_group_grants",
    ] as const)
      expectNoTableScan(w.ctx, staffSql.members(source), ["[3,4]"]);
    expectNoTableScan(w.ctx, staffBanSql, ["[1,2]"]);
  });
});

describe("users.birthdays", () => {
  test("today's birthdays (UTC), oldest account first, banned members left out", async () => {
    const w = world();
    // The test clock starts on 2026-01-01.
    const a = w.user();
    const b = w.user();
    const banned = w.user();
    const other = w.user();
    const year = w.user();
    w.set(a.id, { birthday_md: "01-01" });
    w.set(b.id, { birthday_md: "01-01", birth_year: 1980 });
    w.set(banned.id, { birthday_md: "01-01", banned_permanently: 1 });
    w.set(other.id, { birthday_md: "01-02" });
    w.set(year.id, { birthday_md: "01-01", birth_year: 2000 });
    const result = await w.call("users.birthdays", GUEST, {});
    expect(result.items.map((card: { id: number }) => card.id)).toEqual([a.id, b.id, year.id]);
    w.ctx.clock.advance(86_400_000);
    const next = await w.call("users.birthdays", GUEST, {});
    expect(next.items.map((card: { id: number }) => card.id)).toEqual([other.id]);
  });

  test("on 28 February of a year without a 29th, those born on 29 February too", async () => {
    const w = world();
    const feb28 = w.user();
    const feb29 = w.user();
    const feb27 = w.user();
    w.set(feb28.id, { birthday_md: "02-28" });
    w.set(feb29.id, { birthday_md: "02-29" });
    w.set(feb27.id, { birthday_md: "02-27" });
    const ids = async () =>
      (await w.call("users.birthdays", GUEST, {})).items.map((card: { id: number }) => card.id);
    w.ctx.clock.set(Date.UTC(2026, 1, 28, 12));
    expect(await ids()).toEqual([feb28.id, feb29.id]);
    w.ctx.clock.set(Date.UTC(2026, 1, 27, 12));
    expect(await ids()).toEqual([feb27.id]);
    w.ctx.clock.set(Date.UTC(2026, 2, 1, 12));
    expect(await ids()).toEqual([]);
    // In a leap year the 29th is its own day and the 28th lists only its own.
    w.ctx.clock.set(Date.UTC(2028, 1, 28, 12));
    expect(await ids()).toEqual([feb28.id]);
    w.ctx.clock.set(Date.UTC(2028, 1, 29, 12));
    expect(await ids()).toEqual([feb29.id]);
  });

  test("at most 50", async () => {
    const w = world();
    for (let i = 0; i < 60; i++) w.set(w.user().id, { birthday_md: "01-01" });
    expect((await w.call("users.birthdays", w.memberActor, {})).items).toHaveLength(50);
  });

  test("the query reads users_birthday", () => {
    const w = world();
    expectNoTableScan(w.ctx, birthdaySql, ["01-01", 0, 51]);
  });
});
