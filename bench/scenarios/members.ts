import type { BenchEnv, Scenario } from "../harness";

const choose = (values: number[], i: number) => values[i % values.length]!;
/** `count` member ids starting at a position that moves with the iteration. */
const window = (env: BenchEnv, i: number, count: number) =>
  Array.from({ length: count }, (_, k) => choose(env.meta.memberIds, i * 37 + k * 11));

/**
 * The seeded data has no birthdays and no standings (the standings job reads the month in
 * progress, and the seed ends before it), so the scenarios that need them prepare them here.
 */
export const scenarios: Scenario[] = [
  {
    name: "users.cards 20 ids",
    kind: "read",
    run: (env, i) => env.call("users.cards", env.actors.guest, { userIds: window(env, i, 20) }),
  },
  {
    name: "users.authors 20 ids",
    kind: "read",
    run: (env, i) => env.call("users.authors", env.actors.guest, { userIds: window(env, i, 20) }),
  },
  {
    name: "profiles.get with the member fields",
    kind: "read",
    run: (env, i) =>
      env.call("profiles.get", env.actors.member(i), {
        userId: choose(env.meta.memberIds, i * 13 + 5),
      }),
  },
  {
    name: "users.list newest",
    kind: "read",
    run: (env, i) => env.call("users.list", env.actors.member(i), { sort: "newest", limit: 20 }),
  },
  {
    name: "users.list posts",
    kind: "read",
    run: (env, i) => env.call("users.list", env.actors.member(i), { sort: "posts", limit: 20 }),
  },
  {
    name: "users.list level",
    kind: "read",
    run: (env, i) => env.call("users.list", env.actors.member(i), { sort: "level", limit: 20 }),
  },
  {
    name: "users.staff",
    kind: "read",
    run: (env, i) => env.call("users.staff", env.actors.member(i), {}),
  },
  {
    name: "users.birthdays",
    kind: "read",
    setup(env) {
      const today = new Date(env.ctx.now());
      const day = `${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
      env.ctx.sqlite
        .prepare("UPDATE users SET birthday_md = ?1 WHERE id IN (SELECT value FROM json_each(?2))")
        .run(day, JSON.stringify(env.meta.memberIds.slice(0, 40)));
    },
    run: (env, i) => env.call("users.birthdays", env.actors.member(i), {}),
  },
  {
    name: "standings.month",
    kind: "read",
    setup(env) {
      const now = new Date(env.ctx.now());
      const month = now.getUTCFullYear() * 100 + now.getUTCMonth() + 1;
      env.ctx.sqlite.prepare("DELETE FROM member_month_stats WHERE month = ?1").run(month);
      const insert = env.ctx.sqlite.prepare(
        "INSERT INTO member_month_stats (month, user_id, posts, reactions, referrals, points_tenths) VALUES (?1, ?2, ?3, ?4, 0, ?5)",
      );
      env.ctx.sqlite.transaction(() => {
        env.meta.memberIds.slice(0, 3000).forEach((id, index) => {
          const posts = 1 + (index % 17);
          const reactions = (index * 7) % 40;
          insert.run(month, id, posts, reactions, Math.round(10 * (posts + reactions / 10)));
        });
      })();
    },
    run: (env, i) =>
      env.call("standings.month", env.actors.member(i), { month: "current", limit: 20 }),
  },
];
