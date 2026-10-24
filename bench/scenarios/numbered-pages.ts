import type { Actor } from "@sermo/core";
import type { BenchEnv, Scenario } from "../harness";

// The dearest numbered page of the longest lists, worked out once in setup from the list's own
// total. A conversation and an inbox are placed from their first page, so their last page skips
// the most. A forum's threads are placed from the nearer end of the list, so its last page is
// cheap and its middle page skips the most: both are measured.

type Target = { actor: Actor; input: Record<string, unknown> };

async function pageAt(
  where: "last" | "middle",
  env: BenchEnv,
  operation: string,
  actor: Actor,
  input: Record<string, unknown>,
): Promise<Target> {
  const first = JSON.parse((await env.call(operation, actor, { ...input, page: 1 })) as string) as {
    total: number | null;
  };
  const limit = (input.limit as number | undefined) ?? 20;
  const pages = Math.ceil((first.total ?? 0) / limit);
  if (pages < 10) throw new Error(`${operation}: only ${pages} pages to skip over.`);
  return { actor, input: { ...input, page: where === "last" ? pages : Math.ceil(pages / 2) } };
}
const lastPage = pageAt.bind(null, "last");
const middlePage = pageAt.bind(null, "middle");

const targets = new Map<string, Target[]>();
const scenario = (
  name: string,
  operation: string,
  setup: (env: BenchEnv) => Promise<Target[]>,
): Scenario => ({
  name,
  kind: "read",
  async setup(env) {
    targets.set(name, await setup(env));
  },
  run(env, i) {
    const list = targets.get(name)!;
    const target = list[i % list.length]!;
    return env.call(operation, target.actor, target.input);
  },
});

// The one row a query finds; a seed without it stops the scenario with a reason.
function one<T>(env: BenchEnv, sql: string, missing: string): T {
  const row = env.ctx.sqlite.prepare<T, []>(sql).get();
  if (!row) throw new Error(`The seed has ${missing}.`);
  return row;
}
const biggestForum = (env: BenchEnv) => {
  const id = env.meta.bigForumIds[0];
  if (id === undefined) throw new Error("The seed has no forum with threads.");
  return id;
};

// The seed has no tags: the tag's scenarios put one tag on every thread, whatever its state, of
// the two biggest forums (thousands, more than the 500 the numbered pages hold, with held and
// deleted ones among them for the moderator). Rows are only added, never changed or removed (no
// member is credited with the tag, so no tag count a later scenario reads moves), and a
// second setup on the same database (`--reuse`) finds the tag already there.
const BENCH_TAG = "benchpages";
function benchTag(env: BenchEnv): string {
  const db = env.ctx.sqlite;
  const tagged = db
    .prepare<{ n: number }, [string]>(
      "SELECT count(*) AS n FROM thread_tags WHERE tag_id = (SELECT id FROM tags WHERE name = ?1)",
    )
    .get(BENCH_TAG)!.n;
  if (tagged > 0) return BENCH_TAG;
  const forums = JSON.stringify(env.meta.bigForumIds.slice(0, 2));
  db.transaction(() => {
    db.prepare(
      "INSERT INTO tags (name, created_at) SELECT ?1, ?2 WHERE NOT EXISTS (SELECT 1 FROM tags WHERE name = ?1)",
    ).run(BENCH_TAG, Date.now());
    db.prepare(
      "INSERT INTO thread_tags (thread_id, tag_id, added_by, from_post, sort_at, vis, node_id, author_id, created_at) " +
        "SELECT t.id, (SELECT id FROM tags WHERE name = ?1), NULL, 0, t.sort_at, " +
        "CASE WHEN t.merged_into_id IS NOT NULL THEN 3 WHEN t.state = 'visible' THEN 1 WHEN t.state = 'moderated' THEN 2 ELSE 3 END, " +
        "t.node_id, t.user_id, t.created_at FROM threads t WHERE t.node_id IN (SELECT value FROM json_each(?2))",
    ).run(BENCH_TAG, forums);
  })();
  return BENCH_TAG;
}

export const scenarios: Scenario[] = [
  // The biggest forum, as a member sees it (stored counter) and as a moderator does (held and
  // deleted threads counted and walked too).
  scenario("threads.list last page (member)", "threads.list", async (env) => [
    await lastPage(env, "threads.list", env.actors.member(0), {
      nodeId: biggestForum(env),
    }),
  ]),
  scenario("threads.list last page (moderator)", "threads.list", async (env) => [
    await lastPage(env, "threads.list", env.actors.moderator(0), {
      nodeId: biggestForum(env),
    }),
  ]),
  scenario("threads.list middle page (member)", "threads.list", async (env) => [
    await middlePage(env, "threads.list", env.actors.member(0), {
      nodeId: biggestForum(env),
    }),
  ]),
  scenario("threads.list middle page (moderator)", "threads.list", async (env) => [
    await middlePage(env, "threads.list", env.actors.moderator(0), {
      nodeId: biggestForum(env),
    }),
  ]),
  // A tag on thousands of threads: the capped walk is the same for every page.
  scenario("tags.threads last page", "tags.threads", async (env) => {
    const name = benchTag(env);
    return [
      await lastPage(env, "tags.threads", env.actors.member(0), { name }),
      await lastPage(env, "tags.threads", env.actors.moderator(0), { name }),
    ];
  }),
  // The longest conversation, by an active participant: page 1 is its oldest messages.
  scenario("conversations.listMessages last page", "conversations.listMessages", async (env) => {
    const row = one<{ conversationId: number; userId: number }>(
      env,
      "SELECT c.id AS conversationId, cp.user_id AS userId FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.state = 'active' ORDER BY c.message_count DESC LIMIT 1",
      "no conversation with an active participant",
    );
    return [
      await lastPage(env, "conversations.listMessages", env.actors.user(row.userId), {
        conversationId: row.conversationId,
      }),
    ];
  }),
  // The fullest inbox.
  scenario("conversations.list last page", "conversations.list", async (env) => {
    const row = one<{ userId: number }>(
      env,
      "SELECT user_id AS userId FROM conversation_participants WHERE state = 'active' GROUP BY user_id ORDER BY count(*) DESC LIMIT 1",
      "no member in a conversation",
    );
    return [await lastPage(env, "conversations.list", env.actors.user(row.userId), { limit: 40 })];
  }),
];
