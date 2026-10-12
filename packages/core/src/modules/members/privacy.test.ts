import { describe, expect, test } from "bun:test";
import { GUEST } from "../../actor";
import { userActor } from "../../testing";
import { countStatements } from "../feed/fixtures.test";
import { type World, world } from "./fixtures.test";

/**
 * A private member (`self`), a member visible to the members they follow (`followed`, who
 * follows `w.member`), an open one, and a stranger.
 */
function scene() {
  const w = world();
  const hidden = w.user();
  const followed = w.user();
  const open = w.user();
  const stranger = w.user();
  w.set(hidden.id, { profile_view_privacy: "self" });
  w.set(followed.id, { profile_view_privacy: "followed" });
  w.ctx.sqlite
    .prepare("INSERT INTO user_follows (user_id, followed_id, created_at) VALUES (?1, ?2, 0)")
    .run(followed.id, w.member.id);
  return {
    w,
    hidden,
    followed,
    open,
    viewers: {
      guest: GUEST,
      stranger: userActor(stranger),
      follower: w.memberActor,
      self: userActor(hidden),
    },
  };
}
type Scene = ReturnType<typeof scene>;

const ids = (items: { card?: { id: number }; id?: number }[]) =>
  items.map((item) => item.card?.id ?? item.id!);

/** The same four checks for every list: who sees the private and the followed-only member. */
function checkLists(
  name: string,
  setup: (s: Scene) => void,
  read: (w: World, actor: object) => Promise<number[]>,
) {
  test(`${name}: a private profile is absent for a guest and a stranger, present for the member and a follower`, async () => {
    const s = scene();
    setup(s);
    const { hidden, followed, open, viewers, w } = s;
    for (const viewer of [viewers.guest, viewers.stranger]) {
      const seen = await read(w, viewer);
      expect(seen).toContain(open.id);
      expect(seen).not.toContain(hidden.id);
      expect(seen).not.toContain(followed.id);
    }
    const mine = await read(w, viewers.self);
    expect(mine).toContain(hidden.id);
    expect(mine).not.toContain(followed.id);
    const follower = await read(w, viewers.follower);
    expect(follower).toContain(followed.id);
    expect(follower).not.toContain(hidden.id);
  });
}

const insertStats = (w: World, userId: number, month: number) =>
  w.ctx.sqlite
    .prepare(
      "INSERT INTO member_month_stats (month, user_id, posts, reactions, referrals, points_tenths) VALUES (?1, ?2, 1, 0, 0, 10)",
    )
    .run(month, userId);
const insertWinner = (w: World, userId: number, month: number) =>
  w.ctx.sqlite
    .prepare(
      "INSERT INTO month_winners (month, user_id, posts, reactions, referrals, points_tenths, decided_at) VALUES (?1, ?2, 1, 0, 0, 10, 0)",
    )
    .run(month, userId);

describe("the member lists respect profile privacy", () => {
  checkLists(
    "users.list",
    () => {},
    async (w, actor) =>
      ids((await w.call("users.list", actor, { sort: "newest", limit: 100 })).items),
  );
  checkLists(
    "users.list (by credits)",
    () => {},
    async (w, actor) =>
      ids((await w.call("users.list", actor, { sort: "credits", limit: 100 })).items),
  );
  checkLists(
    "users.birthdays",
    (s) => {
      for (const user of [s.hidden, s.followed, s.open]) s.w.set(user.id, { birthday_md: "01-01" });
    },
    async (w, actor) =>
      (await w.call("users.birthdays", actor, {})).items.map((c: { id: number }) => c.id),
  );
  checkLists(
    "standings.month",
    (s) => {
      for (const user of [s.hidden, s.followed, s.open]) insertStats(s.w, user.id, 202601);
    },
    async (w, actor) =>
      ids((await w.call("standings.month", actor, { month: "current", limit: 100 })).items),
  );
  checkLists(
    "standings.winners",
    (s) => {
      insertWinner(s.w, s.hidden.id, 202512);
      insertWinner(s.w, s.followed.id, 202511);
      insertWinner(s.w, s.open.id, 202510);
    },
    async (w, actor) => ids((await w.call("standings.winners", actor, {})).items),
  );

  test("a page of the list may be short while there is more", async () => {
    const s = scene();
    for (let i = 0; i < 430; i++) s.w.set(s.w.user().id, { profile_view_privacy: "self" });
    const page = await s.w.call("users.list", s.viewers.stranger, { sort: "newest", limit: 3 });
    expect(page.items.length).toBeLessThan(3);
    expect(page.nextCursor).not.toBeNull();
  });

  test("the statements of a page do not grow with the members on it", async () => {
    const s = scene();
    const { w } = s;
    for (let i = 0; i < 60; i++) {
      const user = w.user();
      w.set(user.id, {
        birthday_md: "01-01",
        profile_view_privacy: i % 3 === 0 ? "self" : "everyone",
      });
      insertStats(w, user.id, 202601);
      if (i < 12) insertWinner(w, user.id, 202501 + i);
    }
    const calls: [string, object][] = [
      ["users.list", { sort: "newest" }],
      ["users.list", { sort: "posts" }],
      ["users.birthdays", {}],
      ["standings.month", { month: "current" }],
    ];
    for (const [name, input] of calls) {
      const some = (limit: number) =>
        countStatements(w.ctx, () =>
          name === "users.birthdays"
            ? w.call(name, s.viewers.stranger, input)
            : w.call(name, s.viewers.stranger, { ...input, limit }),
        );
      await some(2);
      const small = await some(2);
      const large = await some(20);
      expect([name, large - small]).toEqual([name, 0]);
    }
    const winners = (limit: number) =>
      countStatements(w.ctx, () => w.call("standings.winners", s.viewers.stranger, { limit }));
    await winners(1);
    expect((await winners(5)) - (await winners(1))).toBe(0);
  });
});
