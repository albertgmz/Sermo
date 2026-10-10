import type { Scenario } from "../harness";

let deepCursors: string[] = [];
let commentPostId = 0;
let editablePostId = 0;
let editableAuthorId = 0;
let restorablePostId = 0;
let searchPrefix = "";

export const scenarios: Scenario[] = [
  {
    name: "profiles.get privacy",
    kind: "read",
    setup(env) {
      env.ctx.sqlite
        .prepare("UPDATE users SET profile_view_privacy = 'members' WHERE id = ?1")
        .run(env.meta.bigWallUserIds[0]!);
    },
    run: (env) =>
      env.call("profiles.get", env.actors.member(0), { userId: env.meta.bigWallUserIds[0]! }),
    teardown(env) {
      env.ctx.sqlite
        .prepare("UPDATE users SET profile_view_privacy = 'everyone' WHERE id = ?1")
        .run(env.meta.bigWallUserIds[0]!);
    },
  },
  {
    name: "profiles.get",
    kind: "read",
    run: (env, i) =>
      env.call("profiles.get", env.actors.guest, {
        userId: env.meta.bigWallUserIds[i % env.meta.bigWallUserIds.length]!,
      }),
  },
  {
    name: "profilePosts.list first",
    kind: "read",
    run: (env, i) =>
      env.call("profilePosts.list", env.actors.guest, {
        userId: env.meta.bigWallUserIds[i % env.meta.bigWallUserIds.length]!,
        limit: 20,
      }),
  },
  {
    name: "profilePosts.list deep",
    kind: "read",
    setup(env) {
      const stmt = env.ctx.sqlite.prepare<{ id: number }, [number]>(
        "SELECT id FROM profile_posts WHERE profile_user_id = ?1 ORDER BY id DESC LIMIT 101",
      );
      deepCursors = env.meta.bigWallUserIds.map((id) =>
        Buffer.from(JSON.stringify([stmt.all(id).at(-1)!.id])).toString("base64url"),
      );
    },
    run: (env, i) =>
      env.call("profilePosts.list", env.actors.guest, {
        userId: env.meta.bigWallUserIds[i % env.meta.bigWallUserIds.length]!,
        cursor: deepCursors[i % deepCursors.length]!,
        limit: 20,
      }),
  },
  {
    name: "profileComments.list",
    kind: "read",
    setup(env) {
      commentPostId = env.ctx.sqlite
        .prepare<{ profile_post_id: number }, []>(
          "SELECT c.profile_post_id FROM profile_post_comments c JOIN profile_posts p ON p.id = c.profile_post_id " +
            "WHERE p.state = 'visible' GROUP BY c.profile_post_id ORDER BY count(*) DESC LIMIT 1",
        )
        .get()!.profile_post_id;
    },
    run: (env) =>
      env.call("profileComments.list", env.actors.guest, {
        profilePostId: commentPostId,
        limit: 20,
      }),
  },
  {
    name: "users.search",
    kind: "read",
    setup(env) {
      searchPrefix = env.ctx.sqlite
        .prepare<{ prefix: string }, []>(
          "SELECT substr(username_key, 1, 2) AS prefix FROM users GROUP BY prefix ORDER BY count(*) DESC LIMIT 1",
        )
        .get()!.prefix;
    },
    run: (env) => env.call("users.search", env.actors.guest, { prefix: searchPrefix, limit: 25 }),
  },
  {
    name: "profilePosts.create",
    kind: "write",
    run: (env, i) =>
      env.call("profilePosts.create", env.actors.member(i), {
        userId: env.meta.bigWallUserIds[i % env.meta.bigWallUserIds.length]!,
        body: `Benchmark wall post ${i}`,
      }),
  },
  {
    name: "profileComments.create",
    kind: "write",
    run: (env, i) =>
      env.call("profileComments.create", env.actors.member(i), {
        profilePostId: env.meta.profilePostIds[i % env.meta.profilePostIds.length]!,
        body: `Benchmark comment ${i}`,
      }),
  },
  {
    name: "profilePosts.update",
    kind: "write",
    setup(env) {
      const row = env.ctx.sqlite
        .prepare<{ id: number; user_id: number }, []>(
          "SELECT id, user_id FROM profile_posts WHERE state = 'visible' LIMIT 1",
        )
        .get()!;
      editablePostId = row.id;
      editableAuthorId = row.user_id;
    },
    run: (env, i) =>
      env.call("profilePosts.update", env.actors.user(editableAuthorId), {
        profilePostId: editablePostId,
        body: `Updated benchmark wall post ${i}`,
      }),
  },
  {
    name: "profilePosts.delete / restore",
    kind: "write",
    setup(env) {
      restorablePostId = env.ctx.sqlite
        .prepare<{ id: number }, []>("SELECT id FROM profile_posts WHERE state = 'visible' LIMIT 1")
        .get()!.id;
    },
    run(env, i) {
      return env.call(
        i % 2 === 0 ? "profilePosts.delete" : "profilePosts.restore",
        env.actors.admin,
        {
          profilePostId: restorablePostId,
        },
      );
    },
  },
];
