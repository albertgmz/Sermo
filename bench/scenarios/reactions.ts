import type { Actor } from "@sermo/core";
import type { BenchEnv, Scenario } from "../harness";

let posts: { id: number; actor: Actor; reactionTypeId: number }[] = [];
let removePosts: { id: number; actor: Actor }[] = [];
let messages: { id: number; actor: Actor; reactionTypeId: number }[] = [];
let popularPosts: number[] = [];
let ruledPosts: { id: number; actor: Actor }[] = [];
let ruledType = 0;
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

// A reaction type given by members who meet a rule of two cheap criteria, in the forums of
// the posts below: the rule and the forum list are both decided on every reaction. A type cannot
// be deleted, so it is switched on here and off in `stopRuled` (an inactive type is not decided
// for anyone, so the other scenarios, and a reused working copy, keep their baseline).
async function prepareRuled(env: BenchEnv) {
  prepare(env);
  const forumOf = env.ctx.sqlite.prepare<{ id: number; node_id: number }, [string]>(
    "SELECT p.id, t.node_id FROM posts p JOIN threads t ON t.id = p.thread_id WHERE p.id IN (SELECT value FROM json_each(?1))",
  );
  const nodes = new Map(
    forumOf.all(JSON.stringify(posts.map((row) => row.id))).map((r) => [r.id, r.node_id]),
  );
  const forumIds = [...new Set(nodes.values())].slice(0, 100);
  ruledPosts = posts.filter((row) => forumIds.includes(nodes.get(row.id)!));
  if (ruledPosts.length < 120) throw new Error("Reaction benchmark fixtures are missing.");
  const existing = (
    (await env.call("reactionTypes.list", env.actors.admin, {})) as {
      items: { id: number; title: string }[];
    }
  ).items.find((item) => item.title === "Bench rule");
  ruledType = (
    (existing &&
      ((await env.call("reactionTypes.update", env.actors.admin, {
        reactionTypeId: existing.id,
        isActive: true,
        forumIds,
      })) as { id: number })) ??
    ((await env.call("reactionTypes.create", env.actors.admin, {
      title: "Bench rule",
      emoji: "R",
      rule: {
        match: "all",
        conditions: [
          { criterion: "post_count", value: 0 },
          { criterion: "days_registered", value: 0 },
        ],
      },
      forumIds,
    })) as { id: number })
  ).id;
}

async function stopRuled(env: BenchEnv) {
  await env.call("reactionTypes.update", env.actors.admin, {
    reactionTypeId: ruledType,
    isActive: false,
  });
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
    name: "reactions.set posts with a rule and forums",
    kind: "write",
    setup: prepareRuled,
    teardown: stopRuled,
    run(env, i) {
      const row = ruledPosts[i % ruledPosts.length]!;
      // The toggle reads the current state: a member who holds the ruled type moves to the first
      // one, so each request gives the ruled type and is judged against the rule and forums.
      const current = env.ctx.sqlite
        .prepare<{ reaction_type_id: number }, [number, number]>(
          "SELECT reaction_type_id FROM reactions WHERE content_type = 'post' AND content_id = ?1 AND user_id = ?2",
        )
        .get(row.id, (row.actor as { userId: number }).userId)?.reaction_type_id;
      return env.call("reactions.set", row.actor, {
        contentType: "post",
        contentId: row.id,
        reactionTypeId: current === ruledType ? 1 : ruledType,
      });
    },
  },
  {
    name: "reactionTypes.list member with rules",
    kind: "read",
    setup: prepareRuled,
    teardown: stopRuled,
    run: (env, i) => env.call("reactionTypes.list", env.actors.member(i), {}),
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
