import { permissionState, resolveAllCombinations } from "@sermo/core";
import type { BenchEnv, Scenario } from "../harness";

/** Bumps every permission layer, as an administrator editing every group from another process. */
function invalidateEveryLayer(env: BenchEnv): void {
  env.ctx.sqlite.transaction(() => {
    env.ctx.sqlite.run(
      "INSERT INTO permission_layer_versions (group_id, user_id, version) SELECT id, 0, 1 FROM groups WHERE true ON CONFLICT (group_id, user_id) DO UPDATE SET version = version + 1",
    );
    env.ctx.sqlite.run("UPDATE cache_versions SET version = version + 1 WHERE key = 'permissions'");
  })();
}

let rebuilds: ReturnType<typeof setInterval> | undefined;
let rebuildCount = 0;

export const scenarios: Scenario[] = [
  {
    // Every layer reloaded from the database and every member combination resolved, in one go.
    // Requests never pay this: layers reload on demand and combinations resolve lazily and in
    // yielding background batches.
    name: "permissions: full rebuild (all layers, 3,050 combinations)",
    kind: "write",
    iterations: 10,
    budgetExempt: "permission rebuild",
    run(env) {
      env.ctx.caches.delete("permission_state");
      const state = permissionState(env.ctx);
      return resolveAllCombinations(state).length;
    },
  },
  {
    // Reads while another writer invalidates every permission layer every 10 ms: each request
    // after a change reloads the layers it needs, and resolution of the 3,000 combinations runs
    // in background batches between requests.
    name: "threads.list member during permission rebuilds",
    kind: "read",
    iterations: 1000,
    setup(env) {
      rebuildCount = 0;
      rebuilds = setInterval(() => {
        invalidateEveryLayer(env);
        rebuildCount++;
      }, 10);
    },
    teardown() {
      clearInterval(rebuilds);
      if (rebuildCount < 10)
        throw new Error(`Only ${rebuildCount} rebuilds ran during the scenario.`);
    },
    run(env, i) {
      // Spread over many members, so many different combinations are resolved.
      const member = env.actors.member(i * 7);
      return env.call("threads.list", member, {
        nodeId: env.meta.bigForumIds[i % env.meta.bigForumIds.length]!,
      });
    },
  },
];
