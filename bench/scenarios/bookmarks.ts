import type { BenchEnv, Scenario } from "../harness";

const BOOKMARKED = 40;
let listUserId = 0;

/** Toggles one item for one member by reading the current state. */
function toggle(env: BenchEnv, contentType: string, contentId: number, userId: number) {
  const exists = env.ctx.sqlite
    .prepare<{ id: number }, [number, string, number]>(
      "SELECT id FROM bookmarks WHERE user_id = ?1 AND content_type = ?2 AND content_id = ?3",
    )
    .get(userId, contentType, contentId);
  return env.call("bookmarks.set", env.actors.user(userId), {
    contentType,
    contentId,
    bookmarked: !exists,
  });
}

/** Gives one member a page-and-a-half of thread and post bookmarks (idempotent). */
function seed(env: BenchEnv) {
  listUserId = env.meta.memberIds[1]!;
  const insert = env.ctx.sqlite.prepare(
    "INSERT OR IGNORE INTO bookmarks (user_id, content_type, content_id, created_at) VALUES (?1, ?2, ?3, ?4)",
  );
  const now = Date.now();
  env.ctx.sqlite.transaction(() => {
    env.meta.threadIds.slice(0, BOOKMARKED).forEach((id, n) => {
      insert.run(listUserId, "thread", id, now + n);
    });
    env.meta.postAuthors.slice(0, BOOKMARKED).forEach(([id], n) => {
      insert.run(listUserId, "post", id, now + BOOKMARKED + n);
    });
  })();
}

export const scenarios: Scenario[] = [
  {
    name: "bookmarks.set thread",
    kind: "write",
    run: (env) => toggle(env, "thread", env.meta.threadIds[0]!, env.meta.memberIds[0]!),
  },
  {
    name: "bookmarks.set post",
    kind: "write",
    run: (env) => toggle(env, "post", env.meta.postAuthors[0]![0], env.meta.memberIds[0]!),
  },
  {
    name: "bookmarks.set conversation",
    kind: "write",
    run(env) {
      const [conversationId, userId] = env.meta.conversationMembers[0]!;
      return toggle(env, "conversation", conversationId, userId);
    },
  },
  {
    name: "bookmarks.status 100 threads",
    kind: "read",
    setup: seed,
    run: (env) =>
      env.call("bookmarks.status", env.actors.user(listUserId), {
        contentType: "thread",
        ids: env.meta.threadIds.slice(0, 100),
      }),
  },
  {
    name: "bookmarks.list first page",
    kind: "read",
    setup: seed,
    run: (env) => env.call("bookmarks.list", env.actors.user(listUserId), { limit: 20 }),
  },
];
