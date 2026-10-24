/**
 * Who is online: the note every page view takes (in memory, flushed by the scheduled job), the
 * online page and the activity line of a page of members. The seed has no visitors, so the setup
 * gives the last hour 6,000 guests and robots and the last day 2,000 members, each with a place,
 * and puts everything back afterwards.
 */
import { flushVisits } from "@sermo/core";
import { forgetOnlineList } from "../../packages/core/src/modules/members/online";
import type { BenchEnv, Scenario } from "../harness";

const MEMBERS = 2_000;
const GUESTS = 5_000;
const ROBOTS = 1_000;
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";

let members: number[] = [];
let seeded: { id: number; last_activity_at: number | null }[] = [];

function visitors(env: BenchEnv) {
  const { ctx, meta } = env;
  const now = ctx.now();
  members = ctx.sqlite
    .prepare<{ id: number }, [number]>(
      "SELECT id FROM users WHERE erased_at IS NULL ORDER BY id DESC LIMIT ?1",
    )
    .all(MEMBERS)
    .map((row) => row.id);
  seeded = ctx.sqlite
    .prepare<{ id: number; last_activity_at: number | null }, [string]>(
      "SELECT id, last_activity_at FROM users WHERE id IN (SELECT value FROM json_each(?1))",
    )
    .all(JSON.stringify(members));
  const activity = ctx.sqlite.prepare("UPDATE users SET last_activity_at = ?1 WHERE id = ?2");
  const visit = ctx.sqlite.prepare(
    "INSERT INTO online_visitors (visitor_key, user_id, robot, place_kind, place_id, ip, seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  );
  const place = (k: number): [string, number | null] =>
    k % 3 === 0
      ? ["forum", meta.forumIds[k % meta.forumIds.length]!]
      : k % 3 === 1
        ? ["thread", meta.threadIds[k % meta.threadIds.length]!]
        : ["member", meta.memberIds[k % meta.memberIds.length]!];
  ctx.sqlite.transaction(() => {
    members.forEach((id, k) => {
      // A day of members, half a minute apart; the first two hours of them have a place.
      const at = now - k * 40_000;
      activity.run(at, id);
      if (at > now - 60 * 60_000) visit.run(`u:${id}`, id, null, ...place(k), null, at);
    });
    for (let k = 0; k < GUESTS + ROBOTS; k++)
      visit.run(
        `g:bench${k}`,
        null,
        k < ROBOTS ? "google" : null,
        ...place(k),
        `198.51.${(k >> 8) & 255}.${k & 255}`,
        now - (k % 3_600) * 1_000,
      );
  })();
  forgetOnlineList(ctx);
}

function back(env: BenchEnv) {
  const { ctx } = env;
  flushVisits(ctx);
  const activity = ctx.sqlite.prepare("UPDATE users SET last_activity_at = ?1 WHERE id = ?2");
  ctx.sqlite.transaction(() => {
    for (const row of seeded) activity.run(row.last_activity_at, row.id);
    // The seed has no visitors.
    ctx.sqlite.run("DELETE FROM online_visitors");
  })();
  seeded = [];
  forgetOnlineList(ctx);
}

export const scenarios: Scenario[] = [
  {
    // The note a page view takes: a new visitor every time (a hash and the robot check).
    name: "http: page view noted, guest",
    kind: "read",
    teardown: back,
    async run(env, i) {
      const threadId = env.meta.threadIds[i % env.meta.threadIds.length]!;
      const response = await env.request("/api/v1/nodes", {
        headers: {
          "x-sermo-place": `thread:${threadId}`,
          "user-agent": i % 4 === 0 ? `${GOOGLEBOT} ${i}` : `${FIREFOX} ${i}`,
        },
      });
      await response.arrayBuffer();
      if (!response.ok) throw new Error(`GET /nodes -> ${response.status}`);
    },
  },
  {
    name: "online.list guest",
    kind: "read",
    setup: visitors,
    teardown: back,
    run: (env, i) => env.call("online.list", env.actors.guest, { page: 1 + (i % 20) }),
  },
  {
    // The list read afresh on every request: the cost a viewer meets every half minute.
    name: "online.list member, uncached",
    kind: "read",
    setup: visitors,
    teardown: back,
    run: (env, i) => {
      forgetOnlineList(env.ctx);
      return env.call("online.list", env.actors.member(i), {
        type: (["all", "member", "guest", "robot"] as const)[i % 4],
        page: 1 + (i % 5),
      });
    },
  },
  {
    name: "online.list admin, staff view",
    kind: "read",
    setup: visitors,
    teardown: back,
    run: (env, i) => env.call("online.list", env.actors.admin, { page: 1 + (i % 20) }),
  },
  {
    name: "online.counts guest",
    kind: "read",
    setup: visitors,
    teardown: back,
    run: (env) => env.call("online.counts", env.actors.guest, {}),
  },
  {
    // A page of members (the online widget, a thread's authors) with their places.
    name: "users.activity 50 members",
    kind: "read",
    setup: visitors,
    teardown: back,
    run: (env, i) =>
      env.call("users.activity", env.actors.member(i), {
        userIds: Array.from({ length: 50 }, (_, k) => members[(i * 7 + k) % 150]!),
      }),
  },
];
