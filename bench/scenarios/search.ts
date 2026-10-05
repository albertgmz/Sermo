import {
  flushViewCounts,
  type RebuildProgress,
  rebuildCountersChunk,
} from "../../packages/core/src/modules/jobs";
import type { BenchEnv, Scenario } from "../harness";

const term = (env: BenchEnv, group: keyof BenchEnv["meta"]["searchTerms"], i: number) => {
  const terms = env.meta.searchTerms[group];
  return terms[i % terms.length]!;
};
const query = (env: BenchEnv, i: number, group: "common" | "medium" | "rare", member: boolean) =>
  env.call("search.query", member ? env.actors.member(i) : env.actors.guest, {
    q: term(env, group, i),
    limit: 20,
  });
let smallForums: number[] = [];
let flushContexts: BenchEnv["ctx"][] = [];
const heaviest: { stage: RebuildProgress["stage"]; sql: string }[] = [
  { stage: "threads", sql: "SELECT id FROM threads ORDER BY reply_count DESC LIMIT 1" },
  { stage: "nodes", sql: "SELECT id FROM nodes ORDER BY thread_count DESC LIMIT 1" },
  {
    stage: "users",
    sql: "SELECT user_id AS id FROM posts GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1",
  },
  {
    stage: "profile_posts",
    sql: "SELECT id FROM profile_posts ORDER BY comment_count DESC LIMIT 1",
  },
  {
    stage: "conversations",
    sql: "SELECT id FROM conversations ORDER BY message_count DESC LIMIT 1",
  },
  {
    stage: "posts",
    sql: "SELECT content_id AS id FROM reactions WHERE content_type = 'post' GROUP BY content_id ORDER BY COUNT(*) DESC LIMIT 1",
  },
  {
    stage: "profile_post_comments",
    sql: "SELECT content_id AS id FROM reactions WHERE content_type = 'profile_post_comment' GROUP BY content_id ORDER BY COUNT(*) DESC LIMIT 1",
  },
  {
    stage: "conversation_messages",
    sql: "SELECT content_id AS id FROM reactions WHERE content_type = 'conversation_message' GROUP BY content_id ORDER BY COUNT(*) DESC LIMIT 1",
  },
];
const target = new Map<RebuildProgress["stage"], number>();

export const scenarios: Scenario[] = [
  ...(["common", "medium", "rare"] as const).flatMap((group): Scenario[] => [
    {
      name: `search.query guest ${group}`,
      kind: "read",
      run: (env, i) => query(env, i, group, false),
    },
    {
      name: `search.query member ${group}`,
      kind: "read",
      run: (env, i) => query(env, i, group, true),
    },
  ]),
  {
    name: "search.query mixed words guest",
    kind: "read",
    run: (env, i) =>
      env.call("search.query", env.actors.guest, {
        q: `${term(env, "common", i)} ${term(env, "rare", i)}`,
        limit: 20,
      }),
  },
  {
    name: "search.query mixed words member",
    kind: "read",
    run: (env, i) =>
      env.call("search.query", env.actors.member(i), {
        q: `${term(env, "medium", i)} ${term(env, "rare", i)}`,
        limit: 20,
      }),
  },
  {
    name: "search.query titlesOnly",
    kind: "read",
    run: (env, i) =>
      env.call("search.query", env.actors.member(i), {
        q: term(env, "common", i),
        titlesOnly: true,
        limit: 20,
      }),
  },
  {
    name: "search.query small forum",
    kind: "read",
    setup(env) {
      smallForums = env.ctx.sqlite
        .prepare<{ id: number }, []>(
          "SELECT id FROM nodes WHERE type = 'forum' ORDER BY post_count, id LIMIT 20",
        )
        .all()
        .map((row) => row.id);
    },
    run: (env, i) =>
      env.call("search.query", env.actors.member(i), {
        q: term(env, "common", i),
        nodeId: smallForums[i % smallForums.length],
        limit: 20,
      }),
  },
  {
    name: "search.flushViewCounts 5000",
    kind: "write",
    // One measured flush by default; six prefilled buffers also cover --iterations 5 and its warmup.
    iterations: 1,
    setup(env) {
      const viewThreads = env.ctx.sqlite
        .prepare<{ id: number }, []>(
          "SELECT id FROM threads WHERE state = 'visible' ORDER BY (id * 2654435761) % 1000003 LIMIT 5000",
        )
        .all()
        .map((row) => row.id);
      if (viewThreads.length !== 5000) throw new Error("Seed needs 5,000 visible threads.");
      flushContexts = Array.from({ length: 6 }, () => ({
        ...env.ctx,
        views: new Map(viewThreads.map((id) => [id, 1])),
      }));
    },
    run(_env, i) {
      const ctx = flushContexts[i];
      if (!ctx) throw new Error("Flush benchmark supports up to five measured iterations.");
      return flushViewCounts(ctx);
    },
  },
  ...heaviest.map(
    ({ stage, sql }): Scenario => ({
      name: `search.rebuildCounters ${stage} worst`,
      kind: "write",
      iterations: 30,
      setup(env) {
        const id = env.ctx.sqlite.prepare<{ id: number }, []>(sql).get()?.id;
        if (!id) throw new Error(`No ${stage} benchmark target.`);
        target.set(stage, id);
      },
      run: (env) =>
        rebuildCountersChunk(
          env.ctx,
          { stage, after: target.get(stage)! - 1 },
          { enqueueNext: false },
        ),
    }),
  ),
];
