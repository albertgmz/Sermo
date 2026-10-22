import type { BenchEnv, Scenario } from "../harness";

/**
 * The reads of the forum statistics widget, one per tab, as the panel asks them: ten threads,
 * leaving out what the feed leaves out. The site keeps its three biggest forums out of the feed
 * (as fcuba keeps its archives out), the hardest case for the walks that skip them.
 */
const MOST = ["mostReplied", "mostReacted", "mostViewed"] as const;
// What each ranking is ordered by here. The reacted score is made up (the seed's threads carry no
// reaction totals): only the read's cost is measured, not the order.
const SCORE: Record<(typeof MOST)[number], string> = {
  mostReplied: "reply_count",
  mostReacted: "reply_count + view_count % 50",
  mostViewed: "view_count",
};

/** The "most" rankings this file filled (a kind the seed or another scenario filled is left be). */
let filled: string[] = [];
/** The forums the site kept out of the feed before, put back by the teardown. */
let excludedBefore: number[] = [];

async function setup(env: BenchEnv) {
  filled = [];
  for (const kind of MOST) {
    const held = env.ctx.sqlite
      .prepare<{ n: number }, [string]>("SELECT count(*) AS n FROM rankings WHERE kind = ?1")
      .get(kind)!.n;
    if (held > 0) continue;
    // Each forum's 40 best visible threads, as the rankings job stores them.
    env.ctx.sqlite
      .prepare(
        `INSERT INTO rankings (kind, node_id, position, target_id, score) SELECT ?1, node_id, rank - 1, id, score FROM (SELECT id, node_id, ${SCORE[kind]} AS score, row_number() OVER (PARTITION BY node_id ORDER BY ${SCORE[kind]} DESC, id DESC) AS rank FROM threads WHERE state = 'visible' AND first_post_id IS NOT NULL) WHERE rank <= 40`,
      )
      .run(kind);
    filled.push(kind);
  }
  const site = (await env.call("settings.get", env.actors.admin, {})) as {
    feedExcludedForumIds: number[];
  };
  excludedBefore = site.feedExcludedForumIds;
  await env.call("settings.update", env.actors.admin, {
    feedExcludedForumIds: env.meta.bigForumIds.slice(0, 3),
  });
}

async function teardown(env: BenchEnv) {
  await env.call("settings.update", env.actors.admin, { feedExcludedForumIds: excludedBefore });
  for (const kind of filled)
    env.ctx.sqlite.prepare("DELETE FROM rankings WHERE kind = ?1").run(kind);
  filled = [];
}

const TABS = ["latestPosts", "latestThreads", ...MOST] as const;

export const scenarios: Scenario[] = [
  ...TABS.map(
    (by): Scenario => ({
      name: `forum statistics ${by}`,
      kind: "read",
      setup,
      teardown,
      run: (env, i) =>
        env.call("threads.ranked", env.actors.member(i), { by, limit: 10, feed: true }),
    }),
  ),
  {
    name: "forum statistics latestPosts guest",
    kind: "read",
    setup,
    teardown,
    run: (env) =>
      env.call("threads.ranked", env.actors.guest, { by: "latestPosts", limit: 10, feed: true }),
  },
  {
    name: "forum statistics top posters",
    kind: "read",
    run: (env, i) => env.call("users.list", env.actors.member(i), { sort: "posts", limit: 10 }),
  },
];
