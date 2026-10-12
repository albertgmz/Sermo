import { describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { MEMBER_SORTS } from "../../contracts/members";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { expectNoTableScan } from "../../testing";
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
      expectNoTableScan(w.ctx, listSql.below(s), [3, 21]);
    }
  });
});

describe("users.staff", () => {
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

describe("users.setReferrer", () => {
  const refer = (w: World, actor: object, userId: number) =>
    w.call("users.setReferrer", actor, { userId });
  const row = (w: World, id: number) =>
    w.ctx.sqlite
      .prepare<
        { referred_by: number | null; referred_at: number | null; referral_count: number },
        [number]
      >("SELECT referred_by, referred_at, referral_count FROM users WHERE id = ?1")
      .get(id)!;

  test("names the referrer once and counts it", async () => {
    const w = world();
    expect(await refer(w, w.memberActor, w.moderator.id)).toEqual({ ok: true });
    expect(row(w, w.member.id)).toMatchObject({
      referred_by: w.moderator.id,
      referred_at: w.ctx.now(),
    });
    expect(row(w, w.moderator.id).referral_count).toBe(1);
    const other = w.user();
    await refer(w, { kind: "user", userId: other.id, groupId: 2, sessionId: 0 }, w.moderator.id);
    expect(row(w, w.moderator.id).referral_count).toBe(2);
  });

  test("every refusal leaves the counters alone", async () => {
    const w = world();
    await expect(refer(w, GUEST, w.moderator.id)).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(refer(w, w.memberActor, w.member.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(refer(w, w.memberActor, 987654)).rejects.toBeInstanceOf(NotFoundError);
    await refer(w, w.memberActor, w.moderator.id);
    await expect(refer(w, w.memberActor, w.admin.id)).rejects.toBeInstanceOf(ConflictError);
    expect(row(w, w.admin.id).referral_count).toBe(0);
    expect(row(w, w.member.id).referred_by).toBe(w.moderator.id);
    const old = w.user();
    w.ctx.clock.advance(7 * 86_400_000);
    await expect(
      refer(w, { kind: "user", userId: old.id, groupId: 2, sessionId: 0 }, w.admin.id),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(row(w, w.admin.id).referral_count).toBe(0);
    expect(row(w, old.id).referred_by).toBeNull();
  });

  test("the last day of the window still works", async () => {
    const w = world();
    w.ctx.clock.advance(7 * 86_400_000 - 1);
    await refer(w, w.memberActor, w.moderator.id);
    expect(row(w, w.moderator.id).referral_count).toBe(1);
  });
});
