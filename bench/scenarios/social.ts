import type { Scenario } from "../harness";

let watchedUserId = 0;
export const scenarios: Scenario[] = [
  {
    name: "social.threads.watch hot thread",
    kind: "write",
    run(env) {
      const userId = env.meta.memberIds[0]!;
      const exists = env.ctx.sqlite
        .prepare<{ id: number }, [number, number]>(
          "SELECT id FROM thread_watches WHERE thread_id = ?1 AND user_id = ?2",
        )
        .get(env.meta.hotWatchedThreadId, userId);
      return env.call(exists ? "threads.unwatch" : "threads.watch", env.actors.user(userId), {
        threadId: env.meta.hotWatchedThreadId,
      });
    },
  },
  {
    name: "social.users.follow popular member",
    kind: "write",
    run(env) {
      const userId = env.meta.memberIds[0]!;
      const followedId = env.meta.popularUserIds.find((id) => id !== userId)!;
      const exists = env.ctx.sqlite
        .prepare<{ id: number }, [number, number]>(
          "SELECT id FROM user_follows WHERE user_id = ?1 AND followed_id = ?2",
        )
        .get(userId, followedId);
      return env.call(exists ? "users.unfollow" : "users.follow", env.actors.user(userId), {
        userId: followedId,
      });
    },
  },
  {
    name: "social.watches.listThreads many watches",
    kind: "read",
    setup(env) {
      watchedUserId = env.ctx.sqlite
        .prepare<{ user_id: number }, []>(
          "SELECT user_id FROM thread_watches GROUP BY user_id ORDER BY count(*) DESC LIMIT 1",
        )
        .get()!.user_id;
    },
    run(env) {
      return env.call("watches.listThreads", env.actors.user(watchedUserId), { limit: 20 });
    },
  },
  {
    name: "social.users.listFollowers popular member",
    kind: "read",
    run(env, i) {
      return env.call("users.listFollowers", env.actors.member(i), {
        userId: env.meta.popularUserIds[i % env.meta.popularUserIds.length]!,
        limit: 20,
      });
    },
  },
];
