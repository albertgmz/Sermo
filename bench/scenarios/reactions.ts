import type { BenchEnv, Scenario } from "../harness";

let posts: { id: number; userId: number }[] = [];
let messages: { id: number; userId: number }[] = [];
let popularPosts: number[] = [];

function prepare(env: BenchEnv) {
  const seededReaction = env.ctx.sqlite.prepare<{ user_id: number }, [number]>(
    "SELECT user_id FROM reactions WHERE content_type = 'post' AND content_id = ?1 LIMIT 1",
  );
  posts = env.meta.postAuthors.map(([id, authorId], i) => ({
    id,
    userId:
      (i % 2 === 0 ? seededReaction.get(id)?.user_id : undefined) ??
      env.meta.memberIds.find(
        (candidate, offset) => offset >= i % env.meta.memberIds.length && candidate !== authorId,
      ) ??
      env.meta.memberIds.find((candidate) => candidate !== authorId)!,
  }));
  messages = env.ctx.sqlite
    .prepare<{ id: number; userId: number }, []>(
      "SELECT m.id, cp.user_id AS userId FROM conversation_messages m JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.state = 'active' AND cp.user_id != m.user_id WHERE m.state = 'visible' LIMIT 500",
    )
    .all();
  popularPosts = env.ctx.sqlite
    .prepare<{ content_id: number }, []>(
      "SELECT content_id FROM reactions WHERE content_type = 'post' GROUP BY content_id HAVING count(*) >= 20 LIMIT 100",
    )
    .all()
    .map((row) => row.content_id);
  if (!posts.length || !messages.length || !popularPosts.length)
    throw new Error("Reaction benchmark fixtures are missing.");
}

export const scenarios: Scenario[] = [
  {
    name: "reactionTypes.list",
    kind: "read",
    run: (env) => env.call("reactionTypes.list", env.actors.guest, {}),
  },
  {
    name: "reactions.set posts",
    kind: "write",
    setup: prepare,
    run(env, i) {
      const row = posts[i % posts.length]!;
      const current = env.ctx.sqlite
        .prepare<{ reaction_type_id: number }, [number, number]>(
          "SELECT reaction_type_id FROM reactions WHERE content_type = 'post' AND content_id = ?1 AND user_id = ?2",
        )
        .get(row.id, row.userId);
      return env.call("reactions.set", env.actors.user(row.userId), {
        contentType: "post",
        contentId: row.id,
        reactionTypeId: current?.reaction_type_id === 1 ? 2 : 1,
      });
    },
  },
  {
    name: "reactions.remove posts",
    kind: "write",
    setup: prepare,
    run(env, i) {
      const row = posts[i % posts.length]!;
      return env.call("reactions.remove", env.actors.user(row.userId), {
        contentType: "post",
        contentId: row.id,
      });
    },
  },
  {
    name: "reactions.set conversation messages",
    kind: "write",
    setup: prepare,
    run(env, i) {
      const row = messages[i % messages.length]!;
      const current = env.ctx.sqlite
        .prepare<{ reaction_type_id: number }, [number, number]>(
          "SELECT reaction_type_id FROM reactions WHERE content_type = 'conversation_message' AND content_id = ?1 AND user_id = ?2",
        )
        .get(row.id, row.userId);
      return env.call("reactions.set", env.actors.user(row.userId), {
        contentType: "conversation_message",
        contentId: row.id,
        reactionTypeId: current?.reaction_type_id === 1 ? 2 : 1,
      });
    },
  },
  {
    name: "reactions.list popular posts",
    kind: "read",
    setup: prepare,
    run: (env, i) =>
      env.call("reactions.list", env.actors.admin, {
        contentType: "post",
        contentId: popularPosts[i % popularPosts.length],
        limit: 20,
      }),
  },
];
