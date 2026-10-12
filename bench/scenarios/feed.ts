import type { Scenario } from "../harness";

const choose = (values: number[], i: number) => values[i % values.length]!;

let followingUserId = 0;
let prefixedForumId = 0;
let prefixId = 0;

/**
 * The seeded data has no prefixes and no rankings (the ranking job reads only the last 30 days,
 * and the seed ends before them), so the scenarios that need them prepare them here, directly.
 */
export const scenarios: Scenario[] = [
  {
    name: "feed.list latest guest",
    kind: "read",
    run: (env) => env.call("feed.list", env.actors.guest, { limit: 20 }),
  },
  {
    name: "feed.list latest member",
    kind: "read",
    run: (env, i) => env.call("feed.list", env.actors.member(i), { limit: 20 }),
  },
  {
    name: "feed.list following",
    kind: "read",
    setup(env) {
      // The member who follows the most people: the worst case for the per-author walk.
      followingUserId = env.ctx.sqlite
        .prepare<{ user_id: number }, []>(
          "SELECT user_id FROM user_follows GROUP BY user_id ORDER BY count(*) DESC LIMIT 1",
        )
        .get()!.user_id;
    },
    run: (env) =>
      env.call("feed.list", env.actors.user(followingUserId), { scope: "following", limit: 20 }),
  },
  {
    name: "feed.list top",
    kind: "read",
    setup(env) {
      // The posts spread over their forums, best first within each forum.
      env.ctx.sqlite.exec("DELETE FROM rankings WHERE kind = 'feedTop'");
      env.ctx.sqlite
        .prepare(
          "INSERT INTO rankings (kind, node_id, position, target_id, score) SELECT 'feedTop', node_id, row_number() OVER (PARTITION BY node_id ORDER BY score DESC, id) - 1, id, score FROM (SELECT p.id AS id, t.node_id AS node_id, 1000 - j.key AS score FROM json_each(?1) AS j JOIN posts p ON p.id = j.value JOIN threads t ON t.id = p.thread_id)",
        )
        .run(JSON.stringify(env.meta.postAuthors.slice(0, 200).map(([postId]) => postId)));
    },
    run: (env, i) => env.call("feed.list", env.actors.member(i), { scope: "top" }),
  },
  {
    name: "threads.ranked latestPosts",
    kind: "read",
    run: (env, i) => env.call("threads.ranked", env.actors.member(i), { by: "latestPosts" }),
  },
  {
    name: "threads.ranked mostReplied",
    kind: "read",
    setup(env) {
      env.ctx.sqlite.exec("DELETE FROM rankings WHERE kind = 'mostReplied'");
      env.ctx.sqlite.exec(
        "INSERT INTO rankings (kind, node_id, position, target_id, score) SELECT 'mostReplied', node_id, rank - 1, id, reply_count FROM (SELECT id, node_id, reply_count, row_number() OVER (PARTITION BY node_id ORDER BY reply_count DESC, id DESC) AS rank FROM threads WHERE state = 'visible' AND reply_count > 0) WHERE rank <= 20",
      );
    },
    run: (env, i) => env.call("threads.ranked", env.actors.member(i), { by: "mostReplied" }),
  },
  {
    name: "threads.byAuthor",
    kind: "read",
    run: (env, i) =>
      env.call("threads.byAuthor", env.actors.member(i), {
        userId: choose(env.meta.memberIds, i * 7 + 1),
        limit: 20,
      }),
  },
  {
    name: "posts.byAuthor",
    kind: "read",
    run: (env, i) =>
      env.call("posts.byAuthor", env.actors.member(i), {
        userId: choose(env.meta.memberIds, i * 7 + 1),
        limit: 20,
      }),
  },
  {
    name: "auth.counters",
    kind: "read",
    run: (env, i) =>
      env.call("auth.counters", env.actors.user(choose(env.meta.busyConversationUserIds, i)), {}),
  },
  {
    name: "threads.list with a prefix",
    kind: "read",
    setup(env) {
      prefixedForumId = env.meta.bigForumIds[0]!;
      prefixId = env.ctx.sqlite
        .prepare<{ id: number }, []>(
          "INSERT INTO thread_prefixes (label, color_id, created_at, updated_at) VALUES ('Bench', (SELECT id FROM palette_colors WHERE kind = 'prefix' ORDER BY position LIMIT 1), 1, 1) RETURNING id",
        )
        .get()!.id;
      env.ctx.sqlite
        .prepare("UPDATE threads SET prefix_id = ?1 WHERE node_id = ?2 AND id % 3 = 0")
        .run(prefixId, prefixedForumId);
      env.ctx.sqlite.exec(
        "INSERT INTO cache_versions (key, version) VALUES ('thread_prefixes', 1) ON CONFLICT (key) DO UPDATE SET version = version + 1",
      );
    },
    run: (env, i) =>
      env.call("threads.list", env.actors.member(i), {
        nodeId: prefixedForumId,
        prefixId,
        limit: 20,
      }),
  },
];
