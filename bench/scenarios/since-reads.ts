import type { BenchEnv, Scenario } from "../harness";

/*
 * The reads a polling client sends: what is new in an open conversation, at the end of a thread,
 * and in the feed. Each has the common answer (nothing new) and one with a few new entries.
 * Read-only: nothing here changes the seeded rows.
 */

const choose = <T>(values: T[], i: number) => values[i % values.length]!;
const iso = (ms: number) => new Date(ms).toISOString();

/** A conversation, a member of it, and the ids around its newest message. */
let chats: { conversationId: number; userId: number; last: number; previous: number }[] = [];
/** A thread, and the positions around its newest post. */
let threads: { threadId: number; last: number }[] = [];
let followingUserId = 0;
/** The newest activity time of the feed, and the one of its 30th entry. */
let newestAt = 0;
let olderAt = 0;

function prepareChats(env: BenchEnv) {
  const newest = env.ctx.sqlite.prepare<{ last: number }, [number]>(
    "SELECT last_message_id AS last FROM conversations WHERE id = ?1",
  );
  const before = env.ctx.sqlite.prepare<{ previous: number | null }, [number, number]>(
    "SELECT max(id) AS previous FROM conversation_messages WHERE conversation_id = ?1 AND id < ?2",
  );
  chats = env.meta.conversationMembers.slice(0, 300).flatMap(([conversationId, userId]) => {
    const last = newest.get(conversationId)?.last;
    const previous = last ? before.get(conversationId, last)?.previous : null;
    return last && previous ? [{ conversationId, userId, last, previous }] : [];
  });
  if (!chats.length) throw new Error("No conversation with two messages and an active member.");
}

function prepareThreads(env: BenchEnv) {
  const top = env.ctx.sqlite.prepare<{ position: number }, [number]>(
    "SELECT position FROM posts WHERE thread_id = ?1 ORDER BY position DESC LIMIT 1",
  );
  const typical = env.ctx.sqlite
    .prepare<{ id: number }, []>(
      "SELECT id FROM threads WHERE state = 'visible' AND reply_count BETWEEN 3 AND 100 LIMIT 300",
    )
    .all()
    .map((row) => row.id);
  threads = [...env.meta.bigThreadIds.slice(0, 10), ...typical].flatMap((threadId) => {
    const last = top.get(threadId)?.position;
    return last ? [{ threadId, last }] : [];
  });
  if (!threads.length) throw new Error("No thread with replies.");
}

function prepareFeed(env: BenchEnv) {
  const at = env.ctx.sqlite.prepare<{ at: number }, [number]>(
    "SELECT last_post_at AS at FROM threads WHERE state = 'visible' ORDER BY last_post_at DESC LIMIT 1 OFFSET ?1",
  );
  newestAt = at.get(0)!.at;
  olderAt = at.get(30)!.at;
  followingUserId = env.ctx.sqlite
    .prepare<{ user_id: number }, []>(
      "SELECT user_id FROM user_follows GROUP BY user_id ORDER BY count(*) DESC LIMIT 1",
    )
    .get()!.user_id;
}

export const scenarios: Scenario[] = [
  {
    name: "conversations.listMessages after the newest message (nothing new)",
    kind: "read",
    setup: prepareChats,
    run(env, i) {
      const chat = choose(chats, i);
      return env.call("conversations.listMessages", env.actors.user(chat.userId), {
        conversationId: chat.conversationId,
        afterMessageId: chat.last,
      });
    },
  },
  {
    name: "conversations.listMessages after the previous message (one new)",
    kind: "read",
    setup: prepareChats,
    run(env, i) {
      const chat = choose(chats, i);
      return env.call("conversations.listMessages", env.actors.user(chat.userId), {
        conversationId: chat.conversationId,
        afterMessageId: chat.previous,
      });
    },
  },
  {
    name: "posts.list afterPosition the last post (nothing new) guest",
    kind: "read",
    setup: prepareThreads,
    run(env, i) {
      const thread = choose(threads, i);
      return env.call("posts.list", env.actors.guest, {
        threadId: thread.threadId,
        afterPosition: thread.last,
      });
    },
  },
  {
    name: "posts.list afterPosition the last post (nothing new) member",
    kind: "read",
    setup: prepareThreads,
    run(env, i) {
      const thread = choose(threads, i);
      return env.call("posts.list", env.actors.member(i), {
        threadId: thread.threadId,
        afterPosition: thread.last,
      });
    },
  },
  {
    name: "posts.list afterPosition the one before (one new) member",
    kind: "read",
    setup: prepareThreads,
    run(env, i) {
      const thread = choose(threads, i);
      return env.call("posts.list", env.actors.member(i), {
        threadId: thread.threadId,
        afterPosition: thread.last - 1,
      });
    },
  },
  {
    name: "feed.newCount latest guest (nothing new)",
    kind: "read",
    setup: prepareFeed,
    run: (env) =>
      env.call("feed.newCount", env.actors.guest, { scope: "latest", since: iso(newestAt) }),
  },
  {
    name: "feed.newCount latest member (nothing new)",
    kind: "read",
    setup: prepareFeed,
    run: (env, i) =>
      env.call("feed.newCount", env.actors.member(i), { scope: "latest", since: iso(newestAt) }),
  },
  {
    name: "feed.newCount latest member (30 new)",
    kind: "read",
    setup: prepareFeed,
    run: (env, i) =>
      env.call("feed.newCount", env.actors.member(i), { scope: "latest", since: iso(olderAt) }),
  },
  {
    name: "feed.newCount following (nothing new)",
    kind: "read",
    setup: prepareFeed,
    run: (env) =>
      env.call("feed.newCount", env.actors.user(followingUserId), {
        scope: "following",
        since: iso(newestAt),
      }),
  },
  {
    name: "feed.newCount following (30 threads of activity back)",
    kind: "read",
    setup: prepareFeed,
    run: (env) =>
      env.call("feed.newCount", env.actors.user(followingUserId), {
        scope: "following",
        since: iso(olderAt),
      }),
  },
];
