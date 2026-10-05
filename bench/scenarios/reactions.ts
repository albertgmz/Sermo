import type { Actor } from "@sermo/core";
import type { BenchEnv, Scenario } from "../harness";

let posts: { id: number; actor: Actor; reactionTypeId: number }[] = [];
let removePosts: { id: number; actor: Actor }[] = [];
let messages: { id: number; actor: Actor; reactionTypeId: number }[] = [];
let popularPosts: number[] = [];
let ready = false;

function prepare(env: BenchEnv) {
  if (ready) return;
  const visiblePosts = env.ctx.sqlite.prepare<{ id: number; user_id: number }, [string]>(
    "SELECT p.id, p.user_id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id IN (SELECT value FROM json_each(?1)) AND p.state = 'visible' AND t.state = 'visible'",
  );
  const postReaction = env.ctx.sqlite.prepare<
    { user_id: number; reaction_type_id: number },
    [number]
  >(
    "SELECT user_id, reaction_type_id FROM reactions WHERE content_type = 'post' AND content_id = ?1 LIMIT 1",
  );
  const ownPostReaction = env.ctx.sqlite.prepare<{ reaction_type_id: number }, [number, number]>(
    "SELECT reaction_type_id FROM reactions WHERE content_type = 'post' AND content_id = ?1 AND user_id = ?2",
  );
  const postRows = visiblePosts.all(JSON.stringify(env.meta.postAuthors.map(([id]) => id)));
  posts = postRows.map(({ id, user_id: authorId }, i) => {
    const seeded = i % 2 === 0 ? postReaction.get(id) : undefined;
    const userId =
      seeded?.user_id ??
      env.meta.memberIds.find(
        (candidate, offset) => offset >= i % env.meta.memberIds.length && candidate !== authorId,
      ) ??
      env.meta.memberIds.find((candidate) => candidate !== authorId)!;
    const current = seeded?.reaction_type_id ?? ownPostReaction.get(id, userId)?.reaction_type_id;
    return { id, actor: env.actors.user(userId), reactionTypeId: current === 1 ? 2 : 1 };
  });
  removePosts = postRows.flatMap(({ id }) => {
    const reaction = postReaction.get(id);
    return reaction ? [{ id, actor: env.actors.user(reaction.user_id) }] : [];
  });
  const messageReaction = env.ctx.sqlite.prepare<{ reaction_type_id: number }, [number, number]>(
    "SELECT reaction_type_id FROM reactions WHERE content_type = 'conversation_message' AND content_id = ?1 AND user_id = ?2",
  );
  messages = env.ctx.sqlite
    .prepare<{ id: number; userId: number }, []>(
      "SELECT m.id, cp.user_id AS userId FROM conversation_messages m JOIN conversation_participants cp ON cp.conversation_id = m.conversation_id AND cp.state = 'active' AND cp.user_id != m.user_id WHERE m.state = 'visible' LIMIT 500",
    )
    .all()
    .map((row) => ({
      id: row.id,
      actor: env.actors.user(row.userId),
      reactionTypeId: messageReaction.get(row.id, row.userId)?.reaction_type_id === 1 ? 2 : 1,
    }));
  popularPosts = env.ctx.sqlite
    .prepare<{ content_id: number }, []>(
      "SELECT r.content_id FROM reactions r JOIN posts p ON p.id = r.content_id JOIN threads t ON t.id = p.thread_id WHERE r.content_type = 'post' AND p.state = 'visible' AND t.state = 'visible' GROUP BY r.content_id HAVING count(*) >= 20 LIMIT 100",
    )
    .all()
    .map((row) => row.content_id);
  if (
    posts.length < 120 ||
    removePosts.length < 120 ||
    messages.length < 120 ||
    !popularPosts.length
  )
    throw new Error("Reaction benchmark fixtures are missing.");
  ready = true;
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
      return env.call("reactions.set", row.actor, {
        contentType: "post",
        contentId: row.id,
        reactionTypeId: row.reactionTypeId,
      });
    },
  },
  {
    name: "reactions.remove posts",
    kind: "write",
    setup: prepare,
    run(env, i) {
      const row = removePosts[i % removePosts.length]!;
      return env.call("reactions.remove", row.actor, {
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
      return env.call("reactions.set", row.actor, {
        contentType: "conversation_message",
        contentId: row.id,
        reactionTypeId: row.reactionTypeId,
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
