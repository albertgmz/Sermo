import type { BenchEnv, Scenario } from "../harness";

/*
 * The home feed's filters, one scenario per filter and a few combinations: each is one request
 * for a page of 20 through the full app, so the number is the cost of the walk that serves the
 * filter (see `modules/feed/filter.ts` for which index serves which). The seed has no prefixes, no
 * tags, no watches and no thread activity inside the last 30 days, so each scenario prepares what
 * it needs in `setup` and puts it back in `teardown`, directly in the database.
 */

const DAY = 86_400_000;

let prefixId = 0;
let tagId = 0;
let watcherId = 0;
let hiderId = 0;
let followerId = 0;
let readerId = 0;
let originalActivity: { id: number; last_post_at: number }[] = [];
let sinceIso = "";

const big = (env: BenchEnv, n = 1) => env.meta.bigForumIds.slice(0, n);

/** Every `every`th visible thread carries a new prefix. */
const addPrefix = (env: BenchEnv, every = 40) => {
  prefixId = env.ctx.sqlite
    .prepare<{ id: number }, []>(
      "INSERT INTO thread_prefixes (label, color_id, created_at, updated_at) VALUES ('Feed bench', (SELECT id FROM palette_colors WHERE kind = 'prefix' ORDER BY position LIMIT 1), 1, 1) RETURNING id",
    )
    .get()!.id;
  env.ctx.sqlite
    .prepare("UPDATE threads SET prefix_id = ?1 WHERE state = 'visible' AND id % ?2 = 0")
    .run(prefixId, every);
  env.ctx.sqlite.exec(
    "INSERT INTO cache_versions (key, version) VALUES ('thread_prefixes', 1) ON CONFLICT (key) DO UPDATE SET version = version + 1",
  );
};
const dropPrefix = (env: BenchEnv) => {
  env.ctx.sqlite.prepare("UPDATE threads SET prefix_id = NULL WHERE prefix_id = ?1").run(prefixId);
  env.ctx.sqlite.prepare("DELETE FROM thread_prefixes WHERE id = ?1").run(prefixId);
  env.ctx.sqlite.exec(
    "INSERT INTO cache_versions (key, version) VALUES ('thread_prefixes', 1) ON CONFLICT (key) DO UPDATE SET version = version + 1",
  );
};

/** One tag on every 40th visible thread (the triggers keep the counters and copies). */
const addTag = (env: BenchEnv) => {
  tagId = env.ctx.sqlite
    .prepare<{ id: number }, [number]>(
      "INSERT INTO tags (name, created_at) VALUES ('feedbench', ?1) RETURNING id",
    )
    .get(env.ctx.now())!.id;
  env.ctx.sqlite
    .prepare(
      "INSERT INTO thread_tags (thread_id, tag_id, added_by, from_post, sort_at, vis, node_id, author_id, created_at) SELECT id, ?1, user_id, 0, sort_at, 1, node_id, user_id, created_at FROM threads WHERE state = 'visible' AND id % 40 = 0",
    )
    .run(tagId);
};
const dropTag = (env: BenchEnv) => {
  env.ctx.sqlite.prepare("DELETE FROM thread_tags WHERE tag_id = ?1").run(tagId);
  env.ctx.sqlite.prepare("DELETE FROM tags WHERE id = ?1").run(tagId);
};

/**
 * 600 threads of the biggest forum get activity in the last two days (the seed ends before the
 * 30 days an unread flag lasts), the original times kept for `calm`.
 */
const wake = (env: BenchEnv) => {
  const now = env.ctx.now();
  originalActivity = env.ctx.sqlite
    .prepare<{ id: number; last_post_at: number }, [number]>(
      "SELECT id, last_post_at FROM threads WHERE node_id = ?1 AND state = 'visible' ORDER BY id DESC LIMIT 600",
    )
    .all(big(env)[0]!);
  const update = env.ctx.sqlite.prepare("UPDATE threads SET last_post_at = ?1 WHERE id = ?2");
  for (const [n, row] of originalActivity.entries()) update.run(now - n * 60_000, row.id);
  sinceIso = new Date(now - 3 * 3_600_000).toISOString();
};
const calm = (env: BenchEnv) => {
  const update = env.ctx.sqlite.prepare("UPDATE threads SET last_post_at = ?1 WHERE id = ?2");
  for (const row of originalActivity) update.run(row.last_post_at, row.id);
  originalActivity = [];
};

const readScenario = (
  name: string,
  input: (env: BenchEnv) => object,
  hooks: Pick<Scenario, "setup" | "teardown"> = {},
  actor: (env: BenchEnv, i: number) => ReturnType<BenchEnv["actors"]["member"]> = (env, i) =>
    env.actors.member(i),
): Scenario => ({
  name,
  kind: "read",
  ...hooks,
  run: (env, i) => env.call("feed.list", actor(env, i), { limit: 20, ...input(env) }),
});

export const scenarios: Scenario[] = [
  readScenario("feed.list filter forum", (env) => ({ forumIds: big(env) })),
  readScenario("feed.list filter forums (three)", (env) => ({ forumIds: big(env, 3) })),
  // The most forums one walk visits one by one: each refill reads that many forums' newest threads.
  readScenario("feed.list filter forums (up to 64)", (env) => ({ forumIds: big(env, 64) })),
  readScenario("feed.list filter rare prefix with forums left out", () => ({ prefixId }), {
    async setup(env) {
      addPrefix(env, 5000);
      await env.call("settings.update", env.actors.admin, { feedExcludedForumIds: big(env, 3) });
    },
    async teardown(env) {
      await env.call("settings.update", env.actors.admin, { feedExcludedForumIds: [] });
      dropPrefix(env);
    },
  }),
  readScenario(
    "feed.list filter forum and a rare prefix",
    (env) => ({ forumIds: big(env), prefixId }),
    { setup: (env) => addPrefix(env, 5000), teardown: dropPrefix },
  ),
  readScenario(
    "feed.list filter forums (up to 64) and unread, all read",
    (env) => ({ forumIds: big(env, 64), unread: true }),
    {
      // The worst case for unread: the member has read everything recent, so every candidate
      // is probed and none passes.
      setup(env) {
        wake(env);
        readerId = env.meta.memberIds[1]!;
        env.ctx.sqlite
          .prepare(
            "INSERT OR IGNORE INTO thread_reads (user_id, thread_id, last_read_post_id, last_read_position, read_at) SELECT ?1, id, last_post_id, 0, 1 FROM threads WHERE node_id = ?2 AND state = 'visible' ORDER BY id DESC LIMIT 600",
          )
          .run(readerId, big(env)[0]!);
      },
      teardown(env) {
        // Only the rows marked with a read time of 1: the seeded reads stay.
        env.ctx.sqlite
          .prepare("DELETE FROM thread_reads WHERE user_id = ?1 AND read_at = 1")
          .run(readerId);
        calm(env);
      },
    },
    (env) => env.actors.user(readerId),
  ),
  readScenario("feed.list filter prefix", () => ({ prefixId }), {
    setup: (env) => addPrefix(env),
    teardown: dropPrefix,
  }),
  readScenario("feed.list filter sticky", () => ({ type: "sticky" }), {
    setup: (env) =>
      void env.ctx.sqlite.exec(
        "UPDATE threads SET is_sticky = 1 WHERE state = 'visible' AND id % 500 = 0",
      ),
    teardown: (env) =>
      void env.ctx.sqlite.exec("UPDATE threads SET is_sticky = 0 WHERE id % 500 = 0"),
  }),
  readScenario("feed.list filter locked", () => ({ type: "locked" }), {
    setup: (env) =>
      void env.ctx.sqlite.exec(
        "UPDATE threads SET is_locked = 1 WHERE state = 'visible' AND id % 50 = 0",
      ),
    teardown: (env) =>
      void env.ctx.sqlite.exec("UPDATE threads SET is_locked = 0 WHERE id % 50 = 0"),
  }),
  readScenario("feed.list filter featured", () => ({ type: "featured" }), {
    setup(env) {
      const now = env.ctx.now();
      env.ctx.sqlite.exec("DELETE FROM thread_features");
      env.ctx.sqlite
        .prepare(
          "INSERT INTO thread_features (thread_id, kind, user_id, started_at, ends_at) SELECT id, CASE WHEN n % 3 = 0 THEN 'paid' ELSE 'staff' END, user_id, ?1 + n, CASE WHEN n % 3 = 0 THEN ?2 ELSE NULL END FROM (SELECT id, user_id, row_number() OVER (ORDER BY id DESC) AS n FROM threads WHERE state = 'visible' AND first_post_id IS NOT NULL LIMIT 150)",
        )
        .run(now, now + DAY);
    },
    teardown: (env) => void env.ctx.sqlite.exec("DELETE FROM thread_features"),
  }),
  readScenario("feed.list filter tag", () => ({ tag: "feedbench" }), {
    setup: addTag,
    teardown: dropTag,
  }),
  readScenario(
    "feed.list filter watched",
    () => ({ watched: true }),
    {
      setup(env) {
        // A member who watches 500 threads: the most the filter looks at.
        watcherId = env.meta.memberIds[0]!;
        // Marked with a creation time of 1, so `teardown` takes out only these rows.
        env.ctx.sqlite
          .prepare(
            "INSERT OR IGNORE INTO thread_watches (user_id, thread_id, email, created_at) SELECT ?1, id, 0, 1 FROM threads WHERE state = 'visible' AND first_post_id IS NOT NULL AND id % 7 = 0 ORDER BY id DESC LIMIT 500",
          )
          .run(watcherId);
      },
      teardown: (env) =>
        void env.ctx.sqlite
          .prepare("DELETE FROM thread_watches WHERE user_id = ?1 AND created_at = 1")
          .run(watcherId),
    },
    (env) => env.actors.user(watcherId),
  ),
  readScenario("feed.list filter unread", () => ({ unread: true }), {
    setup: wake,
    teardown: calm,
  }),
  readScenario(
    "feed.list filter forum and unread",
    (env) => ({ forumIds: big(env), unread: true }),
    { setup: wake, teardown: calm },
  ),
  readScenario(
    "feed.list filter forum, prefix and tag",
    (env) => ({ forumIds: big(env, 3), prefixId, tag: "feedbench" }),
    {
      setup(env) {
        addPrefix(env, 8);
        addTag(env);
      },
      teardown(env) {
        dropPrefix(env);
        dropTag(env);
      },
    },
  ),
  readScenario(
    "feed.list following with a forum filter",
    (env) => ({ scope: "following", forumIds: big(env, 3) }),
    {
      setup(env) {
        // The member who follows the most people: the worst case for the per-author walk.
        followerId = env.ctx.sqlite
          .prepare<{ user_id: number }, []>(
            "SELECT user_id FROM user_follows GROUP BY user_id ORDER BY count(*) DESC LIMIT 1",
          )
          .get()!.user_id;
      },
    },
    (env) => env.actors.user(followerId),
  ),
  readScenario(
    "feed.list hot with a forum filter",
    (env) => ({ scope: "hot", forumIds: big(env, 3) }),
    {
      setup(env) {
        env.ctx.sqlite.exec("DELETE FROM rankings WHERE kind = 'hot'");
        env.ctx.sqlite.exec(
          "INSERT INTO rankings (kind, node_id, position, target_id, score) SELECT 'hot', node_id, rank - 1, id, reply_count FROM (SELECT id, node_id, reply_count, row_number() OVER (PARTITION BY node_id ORDER BY reply_count DESC, id DESC) AS rank FROM threads WHERE state = 'visible' AND first_post_id IS NOT NULL AND reply_count > 0) WHERE rank <= 100",
        );
      },
    },
  ),
  {
    name: "feed.newCount with a filter",
    kind: "read",
    setup: wake,
    teardown: calm,
    run: (env, i) =>
      env.call("feed.newCount", env.actors.member(i), {
        since: sinceIso,
        forumIds: big(env),
        unread: true,
      }),
  },
  readScenario("feed.list with forums left out by the site", () => ({}), {
    async setup(env) {
      await env.call("settings.update", env.actors.admin, { feedExcludedForumIds: big(env, 3) });
    },
    async teardown(env) {
      await env.call("settings.update", env.actors.admin, { feedExcludedForumIds: [] });
    },
  }),
  readScenario(
    "feed.list with forums hidden by the member",
    () => ({}),
    {
      setup(env) {
        hiderId = env.meta.memberIds[0]!;
        const insert = env.ctx.sqlite.prepare(
          "INSERT OR IGNORE INTO feed_hidden_nodes (user_id, node_id, created_at) VALUES (?1, ?2, ?3)",
        );
        for (const id of big(env, 5)) insert.run(hiderId, id, env.ctx.now());
      },
      teardown: (env) =>
        void env.ctx.sqlite
          .prepare("DELETE FROM feed_hidden_nodes WHERE user_id = ?1")
          .run(hiderId),
    },
    (env) => env.actors.user(hiderId),
  ),
  {
    name: "feed.options member",
    kind: "read",
    setup(env) {
      hiderId = env.meta.memberIds[0]!;
      const save = env.ctx.sqlite.prepare(
        "INSERT OR IGNORE INTO feed_filters (user_id, name, name_key, scope, filter, created_at) VALUES (?1, ?2, ?2, 'latest', '{\"unread\":true}', ?3)",
      );
      for (let n = 0; n < 10; n++) save.run(hiderId, `bench ${n}`, env.ctx.now());
    },
    teardown: (env) =>
      void env.ctx.sqlite.prepare("DELETE FROM feed_filters WHERE user_id = ?1").run(hiderId),
    run: (env) => env.call("feed.options", env.actors.user(hiderId), {}),
  },
  {
    // Saving under a name that exists replaces it: one write, whatever the number held.
    name: "feed.saveFilter replace",
    kind: "write",
    setup(env) {
      hiderId = env.meta.memberIds[0]!;
      env.ctx.sqlite.prepare("DELETE FROM feed_filters WHERE user_id = ?1").run(hiderId);
    },
    teardown: (env) =>
      void env.ctx.sqlite.prepare("DELETE FROM feed_filters WHERE user_id = ?1").run(hiderId),
    run: (env, i) =>
      env.call("feed.saveFilter", env.actors.user(hiderId), {
        name: "Bench",
        scope: "latest",
        filter: { forumIds: big(env), unread: i % 2 === 0 },
      }),
  },
  {
    // Hiding a forum already hidden is the same row, so every iteration is one request.
    name: "feed.hideForum",
    kind: "write",
    teardown: (env) => void env.ctx.sqlite.exec("DELETE FROM feed_hidden_nodes"),
    run: (env, i) =>
      env.call("feed.hideForum", env.actors.member(i), {
        nodeId: big(env, 5)[i % 5]!,
        hidden: true,
      }),
  },
];
