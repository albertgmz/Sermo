import { registerJobHandler, registerStandingJobs, runDueJobs } from "@sermo/core";
import { forgetRecentlyActive } from "../../packages/core/src/modules/members/recently-active-cache";
import { redecideChunk } from "../../packages/core/src/modules/members/redecide";
import { requestStandingsRedecide } from "../../packages/core/src/modules/members/redecide-request";
import type { BenchEnv, Scenario } from "../harness";

const choose = (values: number[], i: number) => values[i % values.length]!;
/** `count` member ids starting at a position that moves with the iteration. */
const window = (env: BenchEnv, i: number, count: number) =>
  Array.from({ length: count }, (_, k) => choose(env.meta.memberIds, i * 37 + k * 11));

/**
 * The seed spreads activity over whole days, so the last 24 hours are given 300 members here,
 * a minute apart, one in ten of them hiding their online status: more than the list holds. The
 * seeded values are put back afterwards, so later scenarios read the data as seeded.
 */
const RECENT_COUNT = 300;
let seededActivity: { id: number; last_activity_at: number | null; show_online: number }[] = [];
function recentActivity(env: BenchEnv) {
  const ids = env.meta.memberIds.slice(0, RECENT_COUNT);
  seededActivity = env.ctx.sqlite
    .prepare<{ id: number; last_activity_at: number | null; show_online: number }, [string]>(
      "SELECT id, last_activity_at, show_online FROM users WHERE id IN (SELECT value FROM json_each(?1))",
    )
    .all(JSON.stringify(ids));
  const now = env.ctx.now();
  const update = env.ctx.sqlite.prepare(
    "UPDATE users SET last_activity_at = ?1, show_online = ?2 WHERE id = ?3",
  );
  env.ctx.sqlite.transaction(() => {
    ids.forEach((id, index) => {
      update.run(now - index * 60_000, index % 10 === 9 ? 0 : 1, id);
    });
  })();
  forgetRecentlyActive(env.ctx);
}
function seededActivityBack(env: BenchEnv) {
  const update = env.ctx.sqlite.prepare(
    "UPDATE users SET last_activity_at = ?1, show_online = ?2 WHERE id = ?3",
  );
  env.ctx.sqlite.transaction(() => {
    for (const row of seededActivity) update.run(row.last_activity_at, row.show_online, row.id);
  })();
  seededActivity = [];
  forgetRecentlyActive(env.ctx);
}

/**
 * Deciding every past month again (what a change of the standing rules, or the ban of a winner,
 * queues) reads the posts, reactions and referrals of the whole history, a month per job run.
 * Requests are timed while the runs follow one another; the first complete run reports its time
 * and its longest chunk. The winners it writes are removed afterwards: the seed has none.
 */
let redecideRunning = false;
let redecideLoop: Promise<void> | null = null;
let redecideChunkMs = 0;
async function redecideRuns(env: BenchEnv) {
  registerStandingJobs(env.ctx);
  redecideChunkMs = 0;
  registerJobHandler(
    env.ctx,
    "standings.redecide",
    async (ctx, payload, job) => {
      const start = performance.now();
      await redecideChunk(ctx, (payload as { month: number }).month, job);
      redecideChunkMs = Math.max(redecideChunkMs, performance.now() - start);
    },
    { holdCheckpoints: false },
  );
  const first = performance.now();
  let reported = false;
  while (redecideRunning) {
    requestStandingsRedecide(env.ctx);
    while (redecideRunning && (await runDueJobs(env.ctx, { limit: 1 })))
      await new Promise((resolve) => setImmediate(resolve));
    if (!reported && redecideRunning) {
      console.log(
        `First complete redecide run: ${(performance.now() - first).toFixed(0)} ms; longest chunk (one month): ${redecideChunkMs.toFixed(1)} ms`,
      );
      reported = true;
    }
  }
}

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
    name: "users.relations 50 ids",
    kind: "read",
    run: (env, i) =>
      env.call("users.relations", env.actors.member(i), { userIds: window(env, i, 50) }),
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
  ...(["credits", "level", "reactions"] as const).map(
    (sort): Scenario => ({
      name: `users.list ranked ${sort}`,
      kind: "read",
      run: (env, i) =>
        env.call("users.list", env.actors.member(i), { sort, ranked: true, limit: 20 }),
    }),
  ),
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
    name: "users.recentlyActive guest",
    kind: "read",
    setup: recentActivity,
    teardown: seededActivityBack,
    run: (env) => env.call("users.recentlyActive", env.actors.guest, {}),
  },
  {
    name: "users.recentlyActive member",
    kind: "read",
    setup: recentActivity,
    teardown: seededActivityBack,
    run: (env, i) => env.call("users.recentlyActive", env.actors.member(i), {}),
  },
  {
    // The list read afresh on every request: the cost a viewer meets once a minute.
    name: "users.recentlyActive member, uncached",
    kind: "read",
    setup: recentActivity,
    teardown: seededActivityBack,
    run: (env, i) => {
      forgetRecentlyActive(env.ctx);
      return env.call("users.recentlyActive", env.actors.member(i), {});
    },
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
  {
    name: "standings.winners during a redecide of every past month",
    kind: "read",
    setup(env) {
      redecideRunning = true;
      redecideLoop = redecideRuns(env);
    },
    run: (env, i) => env.call("standings.winners", env.actors.member(i), {}),
    async teardown(env) {
      redecideRunning = false;
      await redecideLoop;
      redecideLoop = null;
      env.ctx.sqlite.run("DELETE FROM jobs WHERE type LIKE 'standings.%'");
      env.ctx.sqlite.run("DELETE FROM month_winners");
      env.ctx.sqlite.run("DELETE FROM site_settings WHERE key = 'standings.decided'");
      // The run rewrites the standing of the previous month.
      const last = new Date(
        Date.UTC(
          new Date(env.ctx.now()).getUTCFullYear(),
          new Date(env.ctx.now()).getUTCMonth() - 1,
          1,
        ),
      );
      env.ctx.sqlite
        .prepare("DELETE FROM member_month_stats WHERE month = ?1")
        .run(last.getUTCFullYear() * 100 + last.getUTCMonth() + 1);
    },
  },
];
