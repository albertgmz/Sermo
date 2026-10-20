import { parseArgs } from "node:util";
import {
  dispatchEvents,
  enqueueJob,
  registerAwardJobs,
  registerJobHandler,
  runDueJobs,
  startJobWorker,
} from "@sermo/core";
import { sweepChunk } from "../../packages/core/src/modules/awards/automatic";
import type { BenchEnv, Scenario } from "../harness";

const WRITE_ITERATIONS = 100;
function fixtureCount(): number {
  const { values } = parseArgs({ options: { iterations: { type: "string" } }, strict: false });
  const count = Number(values.iterations ?? 0) || WRITE_ITERATIONS;
  return count + Math.min(20, Math.ceil(count / 5));
}
async function createAward(env: BenchEnv, fields: Record<string, unknown> = {}): Promise<number> {
  const result = JSON.parse(
    String(
      await env.call("awards.create", env.actors.admin, {
        name: "Benchmark award",
        tier: "silver",
        xp: 5,
        credits: 3,
        ...fields,
      }),
    ),
  ) as { id: number };
  return result.id;
}
/**
 * About a hundred automatic awards of the kinds a large forum runs (fcuba.net: ladders of posts,
 * reactions, referrals and account age, profile set-up, community and economy counts, reactions by
 * type, awards held and items owned). Created through the API, so each rule is validated.
 */
export async function createScaleAwards(env: BenchEnv): Promise<number[]> {
  const ids: number[] = [];
  const add = async (conditions: Record<string, unknown>[], credits = 0) => {
    ids.push(
      await createAward(env, {
        name: `Scale award ${ids.length + 1}`,
        xp: 10 * (1 + (ids.length % 5)),
        credits,
        rule: { match: "all", conditions },
      }),
    );
    return ids.at(-1)!;
  };
  const ladder = async (criterion: string, values: number[], extra = {}) => {
    for (const [i, value] of values.entries())
      await add([{ criterion, value, ...extra }], i % 3 === 2 ? 5 : 0);
  };
  await ladder("post_count", [1, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 25_000]);
  await ladder("reaction_score", [1, 10, 50, 100, 250, 500, 1000, 2500, 5000, 10_000]);
  await ladder("referrals_at_least", [1, 3, 5, 10]);
  await ladder("days_registered", [7, 30, 182, 365, 730, 1095, 1460, 1825, 2190, 2555, 2920, 3650]);
  await add([{ criterion: "has_cover", value: 1 }]);
  await add([{ criterion: "profile_complete", value: 1 }]);
  await ladder("social_links_at_least", [1, 2, 3]);
  await ladder("credits_earned", [100, 500, 1000, 5000]);
  await add([{ criterion: "credits_earned", value: 200, days: 30 }]);
  await ladder("gifted_items", [1, 5, 20]);
  await ladder("replies_received", [10, 50, 100, 500, 1000, 5000]);
  await ladder("most_reacted_post", [5, 10, 25, 50]);
  await ladder("quoted_by_others", [1, 10, 50, 100]);
  await ladder("mentioned_by_others", [1, 10, 50, 100]);
  const gems: number[] = [];
  for (const type of [1, 2, 3, 4, 5, 6])
    for (const value of [10, 100, 1000])
      gems.push(await add([{ criterion: "reactions_received_by_type", ids: [type], value }]));
  for (const rung of [0, 1, 2])
    await add([
      { criterion: "holds_awards", ids: gems.filter((_, i) => i % 3 === rung), mode: "each" },
    ]);
  await ladder("awards_held_at_least", [5, 10, 25, 50]);
  for (const item of env.meta.economy.itemIds.permanent.slice(0, 4))
    await add([{ criterion: "owns_item", ids: [item] }]);
  await add([
    { criterion: "post_count", value: 100 },
    { criterion: "days_registered", value: 365 },
    { criterion: "reaction_score", value: 100 },
  ]);
  return ids;
}

let updateAwardId = 0;
let grantAwardId = 0;
let deleteIds: number[] = [];
let revokeIds: number[] = [];
let grantsCursor: string | undefined;
let holdersCursor: string | undefined;
let maxChunkMs = 0;
let sweepStarted = 0;
let background: Promise<void> | null = null;

function registerMeasuredSweep(env: BenchEnv): void {
  registerAwardJobs(env.ctx);
  maxChunkMs = 0;
  registerJobHandler(env.ctx, "awards.sweep", async (ctx, payload, job) => {
    const start = performance.now();
    await sweepChunk(ctx, (payload as { after: number }).after, job);
    maxChunkMs = Math.max(maxChunkMs, performance.now() - start);
  });
}
async function drain(env: BenchEnv): Promise<void> {
  while (await runDueJobs(env.ctx, { limit: 1 }))
    await new Promise((resolve) => setImmediate(resolve));
}

let scaleReady = false;
let scaleStarted = 0;
let scaleChunks: number[] = [];
let scaleLagMs = 0;
let scaleStop: (() => Promise<void>) | null = null;

const pendingSweeps = (env: BenchEnv) =>
  env.ctx.sqlite
    .prepare<{ n: number }, []>(
      "SELECT count(*) AS n FROM jobs WHERE type = 'awards.sweep' AND status IN ('pending', 'running')",
    )
    .get()!.n;

/**
 * Runs the award sweep over every member against the scale awards as the server does: the job
 * worker polls the queue and events are dispatched every second, on the thread that serves
 * requests. Measuring starts once the first chunk is done; a sweep that ended is started again
 * (then it grants nothing, the daily case).
 */
async function startScaleSweep(env: BenchEnv): Promise<void> {
  if (!scaleReady) {
    const existing = env.ctx.sqlite
      .prepare<{ n: number }, []>(
        "SELECT count(*) AS n FROM awards WHERE name LIKE 'Scale award %'",
      )
      .get()!.n;
    if (existing === 0) await createScaleAwards(env);
    // The award subscriber starts after the seeded history: it judges what this run publishes.
    env.ctx.sqlite
      .prepare(
        "INSERT INTO event_subscribers (name, last_event_id, updated_at) VALUES ('awards', (SELECT coalesce(max(id), 0) FROM domain_events), ?1) " +
          "ON CONFLICT (name) DO UPDATE SET last_event_id = excluded.last_event_id, updated_at = excluded.updated_at",
      )
      .run(env.ctx.now());
    scaleReady = true;
  }
  registerAwardJobs(env.ctx);
  registerJobHandler(env.ctx, "awards.sweep", async (ctx, payload, job) => {
    const start = performance.now();
    await sweepChunk(ctx, (payload as { after: number }).after, job);
    scaleChunks.push(performance.now() - start);
  });
  scaleChunks = [];
  scaleLagMs = 0;
  let last = performance.now();
  const lag = setInterval(() => {
    const now = performance.now();
    scaleLagMs = Math.max(scaleLagMs, now - last - 5);
    last = now;
  }, 5);
  let dispatching: Promise<unknown> | null = null;
  const events = setInterval(() => {
    dispatching ??= dispatchEvents(env.ctx).finally(() => {
      dispatching = null;
    });
  }, 1000);
  const stopWorker = startJobWorker(env.ctx);
  scaleStop = async () => {
    clearInterval(events);
    await stopWorker();
    await dispatching;
    clearInterval(lag);
  };
  if (pendingSweeps(env) === 0) {
    scaleStarted = performance.now();
    enqueueJob(env.ctx, "awards.sweep", { after: 0 }, { uniqueKey: "awards.sweep" });
  }
  while (scaleChunks.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
}

async function stopScaleSweep(env: BenchEnv): Promise<void> {
  await scaleStop?.();
  scaleStop = null;
  await relay?.stop(true);
  relay = null;
  const sorted = scaleChunks.toSorted((a, b) => a - b);
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
  const left = pendingSweeps(env);
  console.log(
    `Award sweep at scale: ${sorted.length} chunks, chunk p95 ${p95.toFixed(2)} ms, max ${(sorted.at(-1) ?? 0).toFixed(2)} ms; ` +
      `longest event-loop stall ${scaleLagMs.toFixed(2)} ms; ${left ? "still running" : `done in ${((performance.now() - scaleStarted) / 1000).toFixed(1)} s`}`,
  );
}

let relay: ReturnType<typeof Bun.serve> | null = null;

/**
 * Sends one call over a local socket, as a visitor's request reaches the server: it is served
 * when the event loop next polls for input, so it waits for whatever background work holds the
 * loop when it arrives (a call made in process would slip in between the work's own promises).
 */
async function overSocket(env: BenchEnv, operation: string, userId: number, input: unknown) {
  relay ??= Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const call = (await request.json()) as { operation: string; userId: number; input: unknown };
      return new Response(
        String(await env.call(call.operation, env.actors.user(call.userId), call.input)),
      );
    },
  });
  const response = await fetch(relay.url, {
    method: "POST",
    body: JSON.stringify({ operation, userId, input }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${operation} -> ${response.status} ${text}`);
  return text;
}

export const scenarios: Scenario[] = [
  {
    name: "awards.list guest",
    kind: "read",
    run: (env) => env.call("awards.list", env.actors.guest, {}),
  },
  {
    name: "awards.list administrator",
    kind: "read",
    run: (env) => env.call("awards.list", env.actors.admin, {}),
  },
  {
    // The awards page reads the categories beside the catalog.
    name: "awardCategories.list guest",
    kind: "read",
    run: (env) => env.call("awardCategories.list", env.actors.guest, {}),
  },
  {
    name: "awards.get",
    kind: "read",
    run: (env) =>
      env.call("awards.get", env.actors.member(0), { awardId: env.meta.economy.awardIds[0]! }),
  },
  {
    name: "awards.holders",
    kind: "read",
    run: (env) =>
      env.call("awards.holders", env.actors.member(0), {
        awardId: env.meta.economy.stackableAwardIds[0]!,
        limit: 20,
      }),
  },
  {
    name: "awards.holders later page",
    kind: "read",
    async setup(env) {
      const page = JSON.parse(
        String(
          await env.call("awards.holders", env.actors.member(0), {
            awardId: env.meta.economy.stackableAwardIds[0]!,
            limit: 100,
          }),
        ),
      ) as { nextCursor: string | null };
      if (!page.nextCursor) throw new Error("awards.holders has no second page.");
      holdersCursor = page.nextCursor;
    },
    run: (env) =>
      env.call("awards.holders", env.actors.member(0), {
        awardId: env.meta.economy.stackableAwardIds[0]!,
        limit: 20,
        cursor: holdersCursor,
      }),
  },
  {
    name: "awards.criteria",
    kind: "read",
    run: (env) => env.call("awards.criteria", env.actors.admin, {}),
  },
  {
    name: "awards.member (800 grants)",
    kind: "read",
    run: (env) =>
      env.call("awards.member", env.actors.user(env.meta.economy.awardHeavyUserId), {
        userId: env.meta.economy.awardHeavyUserId,
      }),
  },
  {
    name: "awards.memberGrants (800 grants)",
    kind: "read",
    run: (env) =>
      env.call("awards.memberGrants", env.actors.user(env.meta.economy.awardHeavyUserId), {
        userId: env.meta.economy.awardHeavyUserId,
        limit: 20,
      }),
  },
  {
    name: "awards.memberGrants later page (800 grants)",
    kind: "read",
    async setup(env) {
      const page = JSON.parse(
        String(
          await env.call(
            "awards.memberGrants",
            env.actors.user(env.meta.economy.awardHeavyUserId),
            { userId: env.meta.economy.awardHeavyUserId, limit: 100 },
          ),
        ),
      ) as { nextCursor: string | null };
      if (!page.nextCursor) throw new Error("awards.memberGrants has no second page.");
      grantsCursor = page.nextCursor;
    },
    run: (env) =>
      env.call("awards.memberGrants", env.actors.user(env.meta.economy.awardHeavyUserId), {
        userId: env.meta.economy.awardHeavyUserId,
        limit: 20,
        cursor: grantsCursor,
      }),
  },
  {
    name: "awards.create",
    kind: "write",
    iterations: WRITE_ITERATIONS,
    run: (env) =>
      env.call("awards.create", env.actors.admin, {
        name: "New benchmark award",
        tier: "gold",
        xp: 10,
        credits: 2,
      }),
  },
  {
    name: "awards.update",
    kind: "write",
    iterations: WRITE_ITERATIONS,
    async setup(env) {
      updateAwardId = await createAward(env);
    },
    run(env) {
      const current = env.ctx.sqlite
        .prepare<{ is_active: number }, [number]>("SELECT is_active FROM awards WHERE id = ?1")
        .get(updateAwardId)!;
      return env.call("awards.update", env.actors.admin, {
        awardId: updateAwardId,
        isActive: !current.is_active,
      });
    },
  },
  {
    name: "awards.delete",
    kind: "write",
    iterations: WRITE_ITERATIONS,
    async setup(env) {
      deleteIds = [];
      for (let i = 0; i < fixtureCount(); i++) deleteIds.push(await createAward(env));
    },
    run(env) {
      const awardId = deleteIds.pop();
      if (awardId === undefined) throw new Error("Award deletion fixtures exhausted.");
      return env.call("awards.delete", env.actors.admin, { awardId });
    },
  },
  {
    name: "awards.grant",
    kind: "write",
    iterations: WRITE_ITERATIONS,
    async setup(env) {
      grantAwardId = await createAward(env, { isStackable: true });
    },
    run: (env) =>
      env.call("awards.grant", env.actors.admin, {
        awardId: grantAwardId,
        userId: env.meta.memberIds[0]!,
        reason: "Benchmark grant",
      }),
  },
  {
    name: "awards.revoke",
    kind: "write",
    iterations: WRITE_ITERATIONS,
    async setup(env) {
      revokeIds = [];
      const awardId = await createAward(env, { isStackable: true });
      for (let i = 0; i < fixtureCount(); i++) {
        const grant = JSON.parse(
          String(
            await env.call("awards.grant", env.actors.admin, {
              awardId,
              userId: env.meta.memberIds[0]!,
            }),
          ),
        ) as { id: number };
        revokeIds.push(grant.id);
      }
    },
    run(env) {
      const memberAwardId = revokeIds.pop();
      if (memberAwardId === undefined) throw new Error("Award revocation fixtures exhausted.");
      return env.call("awards.revoke", env.actors.admin, {
        memberAwardId,
        reason: "Benchmark revoke",
      });
    },
  },
  {
    name: "awards.run",
    kind: "write",
    iterations: WRITE_ITERATIONS,
    run: (env) => env.call("awards.run", env.actors.admin, {}),
  },
  {
    name: "awards.sweep chunk",
    kind: "write",
    iterations: WRITE_ITERATIONS,
    setup(env) {
      registerMeasuredSweep(env);
      sweepStarted = performance.now();
      enqueueJob(env.ctx, "awards.sweep", { after: 0 }, { uniqueKey: "awards.sweep" });
    },
    async run(env) {
      // Background work is measured one chunk at a time, under the normal write budget.
      if (!(await runDueJobs(env.ctx, { limit: 1 }))) {
        enqueueJob(env.ctx, "awards.sweep", { after: 0 }, { uniqueKey: "awards.sweep" });
        await runDueJobs(env.ctx, { limit: 1 });
      }
    },
    async teardown(env) {
      await drain(env);
      console.log(
        `Award sweep: ${(performance.now() - sweepStarted).toFixed(2)} ms; maximum chunk: ${maxChunkMs.toFixed(2)} ms`,
      );
    },
  },
  {
    name: "awards.member during an award sweep",
    kind: "read",
    setup(env) {
      registerMeasuredSweep(env);
      enqueueJob(env.ctx, "awards.sweep", { after: 0 }, { uniqueKey: "awards.sweep" });
      background = drain(env);
    },
    run: (env) =>
      env.call("awards.member", env.actors.user(env.meta.economy.awardHeavyUserId), {
        userId: env.meta.economy.awardHeavyUserId,
      }),
    async teardown() {
      await background;
      background = null;
      console.log(`Maximum concurrent award sweep chunk: ${maxChunkMs.toFixed(2)} ms`);
    },
  },
  {
    name: "awards sweep at scale: threads.list while it runs",
    kind: "read",
    iterations: 3000,
    setup: startScaleSweep,
    run: (env, i) =>
      overSocket(env, "threads.list", env.meta.memberIds[i % env.meta.memberIds.length]!, {
        nodeId: env.meta.forumIds[0]!,
        limit: 20,
      }),
    teardown: stopScaleSweep,
  },
  {
    name: "awards sweep at scale: posts.create while it runs",
    kind: "write",
    iterations: 1000,
    setup: startScaleSweep,
    run: (env, i) =>
      overSocket(env, "posts.create", env.meta.memberIds[i % env.meta.memberIds.length]!, {
        threadId: env.meta.threadIds[0]!,
        body: `Reply while the award sweep runs ${i}.`,
      }),
    teardown: stopScaleSweep,
  },
];
