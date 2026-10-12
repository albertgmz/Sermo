import { enqueueJob, registerCreditJobs, registerJobHandler, runDueJobs } from "@sermo/core";
import {
  CREDIT_RECALCULATE_CHUNK_SIZE,
  recalculateCreditsChunk,
} from "../../packages/core/src/modules/credits/rebuild";
import { encodeCursor } from "../../packages/core/src/pagination";
import { type BenchEnv, BUDGETS, type Scenario } from "../harness";
import { SEED_PASSWORD } from "../seed";

let historyCursor: string;
let ledgerCursor: string;
let adjustmentUserId: number;
let running = false;
let background: Promise<void> | null = null;
let maxChunkMs = 0;
let chunks = 0;
let repaired = 0;
let rebuildError: unknown;

function historyPage(env: BenchEnv) {
  const row = env.ctx.sqlite
    .prepare<{ id: number }, [number]>(
      "SELECT id FROM credit_transactions WHERE user_id = ?1 ORDER BY id DESC LIMIT 1",
    )
    .get(env.meta.economy.richUserIds[0]!);
  if (!row) throw new Error("The seeded rich member has no credit history.");
  historyCursor = encodeCursor([row.id]);
}

function startRebuild(env: BenchEnv): void {
  maxChunkMs = 0;
  chunks = 0;
  repaired = 0;
  rebuildError = undefined;
  registerCreditJobs(env.ctx);
  registerJobHandler(env.ctx, "credits.recalculate", (ctx, payload, job) => {
    const start = performance.now();
    try {
      const changed = recalculateCreditsChunk(ctx, payload, job);
      maxChunkMs = Math.max(maxChunkMs, performance.now() - start);
      chunks++;
      repaired += changed;
    } catch (error) {
      rebuildError = error;
      throw error;
    }
  });
  running = true;
  background = (async () => {
    while (running) {
      enqueueJob(
        env.ctx,
        "credits.recalculate",
        { after: 0 },
        { uniqueKey: "credits.recalculate" },
      );
      await runDueJobs(env.ctx, { limit: 1 });
      await new Promise((resolve) => setImmediate(resolve));
    }
  })();
}

async function finishRebuild(env: BenchEnv): Promise<void> {
  running = false;
  await background;
  background = null;
  // Finish the current pass so the maximum includes every member, even after a short read run.
  while (await runDueJobs(env.ctx, { limit: 1 }))
    await new Promise((resolve) => setImmediate(resolve));
  registerCreditJobs(env.ctx);
  if (rebuildError !== undefined) throw rebuildError;
  if (chunks === 0) throw new Error("No credit rebuild chunks were measured.");
  console.log(
    `Credit rebuild: ${chunks} chunks of at most ${CREDIT_RECALCULATE_CHUNK_SIZE} members; ` +
      `${repaired} balances repaired; maximum chunk: ${maxChunkMs.toFixed(2)} ms`,
  );
  if (maxChunkMs > BUDGETS.max)
    throw new Error(`Credit rebuild chunk ${maxChunkMs.toFixed(2)} ms exceeds ${BUDGETS.max} ms.`);
}

export const scenarios: Scenario[] = [
  {
    name: "credits.history member",
    kind: "read",
    run: (env, i) => env.call("credits.history", env.actors.member(i), { limit: 20 }),
  },
  {
    name: "credits.history rich member, next page",
    kind: "read",
    setup: historyPage,
    run: (env) =>
      env.call("credits.history", env.actors.user(env.meta.economy.richUserIds[0]!), {
        cursor: historyCursor,
        limit: 20,
      }),
  },
  {
    name: "credits.ledger all members",
    kind: "read",
    run: (env) => env.call("credits.ledger", env.actors.admin, { limit: 20 }),
  },
  {
    name: "credits.ledger all members, deep cursor",
    kind: "read",
    setup(env) {
      const last = env.ctx.sqlite
        .prepare<{ id: number }, []>("SELECT id FROM credit_transactions ORDER BY id DESC LIMIT 1")
        .get();
      if (!last) throw new Error("The seeded credit ledger is empty.");
      ledgerCursor = encodeCursor([Math.max(1, Math.floor(last.id / 2))]);
    },
    run: (env) => env.call("credits.ledger", env.actors.admin, { cursor: ledgerCursor, limit: 20 }),
  },
  {
    name: "credits.ledger one member",
    kind: "read",
    run: (env, i) =>
      env.call("credits.ledger", env.actors.moderator(0), {
        userId: env.meta.economy.richUserIds[i % env.meta.economy.richUserIds.length]!,
        limit: 20,
      }),
  },
  {
    name: "credits.ledger one member, next page",
    kind: "read",
    setup: historyPage,
    run: (env) =>
      env.call("credits.ledger", env.actors.admin, {
        userId: env.meta.economy.richUserIds[0]!,
        cursor: historyCursor,
        limit: 20,
      }),
  },
  {
    name: "credits.adjust add and remove",
    kind: "write",
    async setup(env) {
      const username = `creditbench_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
      const response = await env.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({
          name: username,
          username,
          email: `${username}@example.test`,
          password: SEED_PASSWORD,
        }),
      });
      if (!response.ok)
        throw new Error(
          `Credit fixture registration failed: ${response.status} ${await response.text()}`,
        );
      const body = (await response.json()) as { user: { id: string } };
      adjustmentUserId = Number(body.user.id);
    },
    run(env) {
      const balance = env.ctx.sqlite
        .prepare<{ credits: number }, [number]>("SELECT credits FROM users WHERE id = ?1")
        .get(adjustmentUserId)!.credits;
      return env.call("credits.adjust", env.actors.admin, {
        userId: adjustmentUserId,
        amount: balance >= 0 ? -10 : 10,
        reason: "Benchmark adjustment",
      });
    },
  },
  {
    name: "credits.recalculate queue during a rebuild",
    kind: "write",
    setup: startRebuild,
    run: (env) => env.call("credits.recalculate", env.actors.admin, {}),
    teardown: finishRebuild,
  },
  {
    name: "credits.history during a rebuild (60,000 members)",
    kind: "read",
    setup: startRebuild,
    run: (env, i) => env.call("credits.history", env.actors.member(i), { limit: 20 }),
    teardown: finishRebuild,
  },
];
