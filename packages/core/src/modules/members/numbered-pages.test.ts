import { describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { MEMBER_SORTS } from "../../contracts/members";
import { userActor } from "../../testing";
import { pageSql } from "./directory-pages";
import { type World, world } from "./fixtures.test";
import { forgetRestrictedProfiles } from "./restricted-cache";

type Page = { items: { card: { id: number } }[]; nextCursor: string | null; total: number | null };
const read = (w: World, input: object, actor: object) =>
  w.call("users.list", actor, input) as Promise<Page>;
const idsOf = (page: Page) => page.items.map((item) => item.card.id);

/** Every member the viewer is shown, by the cursor walk: what the numbered pages must equal. */
async function walked(w: World, input: object, actor: object) {
  const ids: number[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 100; pages++) {
    const page = await read(w, { ...input, limit: 3, ...(cursor ? { cursor } : {}) }, actor);
    ids.push(...idsOf(page));
    if (page.nextCursor === null) return ids;
    cursor = page.nextCursor;
  }
  throw new Error("the walk did not end");
}

/** Every page of `limit` members from the numbered reads, with the totals they gave. */
async function numbered(w: World, input: object, actor: object, limit: number) {
  const first = await read(w, { ...input, page: 1, limit }, actor);
  const pages = Math.ceil(first.total! / limit);
  const all = await Promise.all(
    Array.from({ length: pages + 1 }, (_, n) => read(w, { ...input, page: n + 1, limit }, actor)),
  );
  return { ids: all.flatMap(idsOf), totals: new Set(all.map((page) => page.total)), pages, all };
}

/** Eleven members with ties in every figure, some of whom the viewers cannot see. */
function crowd() {
  const w = world();
  const values = [5, 5, 3, 3, 1, 0, 9, 9, 2, 7, 4];
  const users = values.map((value) => {
    const user = w.user();
    w.set(user.id, { post_count: value, credits: value - 2 });
    return user;
  });
  w.set(users[0]!.id, { banned_permanently: 1 });
  w.set(users[1]!.id, { profile_view_privacy: "self" });
  w.set(users[2]!.id, { profile_view_privacy: "members" });
  w.set(users[3]!.id, { profile_view_privacy: "followed" });
  w.set(users[4]!.id, { erased_at: w.ctx.now() });
  // An account awaiting approval counts as a closed profile for everyone but staff and itself.
  const awaiting = w.user();
  w.set(awaiting.id, { post_count: 6, credits: 4, signup_review: "pending" });
  w.ctx.sqlite
    .prepare("INSERT INTO user_follows (user_id, followed_id, created_at) VALUES (?1, ?2, 0)")
    .run(users[3]!.id, w.member.id);
  forgetRestrictedProfiles(w.ctx);
  return { w, users };
}

describe("users.list numbered pages", () => {
  const viewers = (w: World) =>
    [
      ["a guest", GUEST],
      ["a member the private ones follow", w.memberActor],
      ["a member nobody follows", userActor(w.user())],
      ["a moderator", w.moderatorActor],
    ] as const;

  for (const sort of MEMBER_SORTS)
    for (const ranked of [false, true])
      test(`${sort}${ranked ? " ranked" : ""}: every numbered page is the cursor walk's page, with the count of what the viewer may open`, async () => {
        const { w } = crowd();
        for (const [who, actor] of viewers(w)) {
          const input = { sort, ranked };
          const walk = await walked(w, input, actor);
          // Limit 4 puts the last page at the end of the list and one more beyond it.
          for (const limit of [4, 5]) {
            const { ids, totals, pages, all } = await numbered(w, input, actor, limit);
            expect(ids, `${who}, limit ${limit}`).toEqual(walk);
            expect([...totals], who).toEqual([walk.length]);
            expect(all.at(-1)!.items, who).toEqual([]);
            expect(pages).toBe(Math.ceil(walk.length / limit));
          }
        }
      });

  test("a numbered read carries a count, a cursor walk does not, and a cursor outranks the page", async () => {
    const { w } = crowd();
    const first = await read(w, { sort: "posts", limit: 3, page: 1 }, GUEST);
    expect(first.total).toBeGreaterThan(0);
    const next = await read(
      w,
      { sort: "posts", limit: 3, cursor: first.nextCursor, page: 1 },
      GUEST,
    );
    expect(next.total).toBeNull();
    expect(idsOf(next)).not.toEqual(idsOf(first));
    expect((await read(w, { sort: "posts", limit: 3 }, GUEST)).total).toBeNull();
  });

  test("a member just made private is not returned even before the placement catches up", async () => {
    const { w, users } = crowd();
    const before = await read(w, { sort: "newest", page: 1, limit: 50 }, GUEST);
    const target = users[6]!.id;
    expect(idsOf(before)).toContain(target);
    // The placement keeps its list of private profiles for a short while: the page itself is read live.
    w.set(target, { profile_view_privacy: "self" });
    const after = await read(w, { sort: "newest", page: 1, limit: 50 }, GUEST);
    expect(idsOf(after)).not.toContain(target);
  });

  test("the list of private profiles is read again when a member changes their privacy", async () => {
    const { w, users } = crowd();
    const target = userActor(users[6]!);
    expect((await read(w, { sort: "newest", page: 1 }, GUEST)).total).toBe(10);
    await w.call("preferences.update", target, { profileViewPrivacy: "self" });
    expect((await read(w, { sort: "newest", page: 1 }, GUEST)).total).toBe(9);
  });

  test("the placement reads each sort's index, never sorts, and finds the few members it skips by index", () => {
    const { w } = crowd();
    const plan = (sql: string, params: unknown[]) =>
      w.ctx.sqlite
        .prepare<{ detail: string }, never[]>(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...(params as never[]))
        .map((row) => row.detail)
        .join("\n");
    const indexes = {
      post_count: "users_post_count",
      reaction_score: "users_reaction_score",
      award_xp: "users_award_xp",
      credits: "users_credits",
      award_count: "users_award_count",
      referral_count: "users_referral_count",
    };
    for (const [column, index] of Object.entries(indexes))
      for (const fromEnd of [false, true]) {
        const text = plan(pageSql.key(column, fromEnd), [0, "[]", 40]);
        expect(text).toContain(`USING COVERING INDEX ${index}`);
        expect(text).not.toContain("TEMP B-TREE");
      }
    expect(plan(pageSql.count("post_count", true), [0])).toContain(
      "COVERING INDEX users_post_count",
    );
    // `newest` walks the primary key without opening a row.
    expect(plan(pageSql.key(null, true), [0, "[]", 40])).not.toContain("TEMP B-TREE");
    expect(plan(pageSql.banned, [])).toContain("users_banned");
    expect(plan(pageSql.erased, [])).toContain("users_erased");
  });
});
