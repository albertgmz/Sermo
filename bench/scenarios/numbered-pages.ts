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

const one = <T>(env: BenchEnv, sql: string): T => env.ctx.sqlite.prepare<T, []>(sql).get() as T;

export const scenarios: Scenario[] = [
  // The biggest forum, as a member sees it (stored counter) and as a moderator does (held and
  // deleted threads counted and walked too).
  scenario("threads.list last page (member)", "threads.list", async (env) => [
    await lastPage(env, "threads.list", env.actors.member(0), {
      nodeId: env.meta.bigForumIds[0],
    }),
  ]),
  scenario("threads.list last page (moderator)", "threads.list", async (env) => [
    await lastPage(env, "threads.list", env.actors.moderator(0), {
      nodeId: env.meta.bigForumIds[0],
    }),
  ]),
  scenario("threads.list middle page (member)", "threads.list", async (env) => [
    await middlePage(env, "threads.list", env.actors.member(0), {
      nodeId: env.meta.bigForumIds[0],
    }),
  ]),
  scenario("threads.list middle page (moderator)", "threads.list", async (env) => [
    await middlePage(env, "threads.list", env.actors.moderator(0), {
      nodeId: env.meta.bigForumIds[0],
    }),
  ]),
  // The tag on the most threads: the capped walk is the same for every page.
  scenario("tags.threads last page", "tags.threads", async (env) => {
    const tag = one<{ name: string }>(
      env,
      "SELECT name FROM tags ORDER BY thread_count DESC LIMIT 1",
    );
    return [
      await lastPage(env, "tags.threads", env.actors.member(0), { name: tag.name }),
      await lastPage(env, "tags.threads", env.actors.moderator(0), { name: tag.name }),
    ];
  }),
  // The longest conversation, by an active participant: page 1 is its oldest messages.
  scenario("conversations.listMessages last page", "conversations.listMessages", async (env) => {
    const row = one<{ conversationId: number; userId: number }>(
      env,
      "SELECT c.id AS conversationId, cp.user_id AS userId FROM conversations c JOIN conversation_participants cp ON cp.conversation_id = c.id AND cp.state = 'active' ORDER BY c.message_count DESC LIMIT 1",
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
    );
    return [await lastPage(env, "conversations.list", env.actors.user(row.userId), { limit: 40 })];
  }),
];
