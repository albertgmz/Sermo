import { flushViewCounts, rebuildCountersChunk } from "../../packages/core/src/modules/jobs";
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
    run: (env, i) =>
      env.call("search.query", env.actors.member(i), {
        q: term(env, "common", i),
        nodeId: env.meta.forumIds[i % env.meta.forumIds.length],
        limit: 20,
      }),
  },
  {
    name: "search.flushViewCounts 5000",
    kind: "write",
    iterations: 30,
    run(env, i) {
      for (let j = 0; j < 5000; j++) {
        const id = env.meta.threadIds[(i * 5000 + j) % env.meta.threadIds.length]!;
        env.ctx.views.set(id, (env.ctx.views.get(id) ?? 0) + 1);
      }
      return flushViewCounts(env.ctx);
    },
  },
  {
    name: "search.rebuildCounters chunk",
    kind: "write",
    iterations: 30,
    run: (env) => rebuildCountersChunk(env.ctx, { stage: "users", after: env.meta.memberIds[0]! }),
  },
];
