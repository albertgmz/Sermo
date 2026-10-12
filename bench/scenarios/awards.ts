import { parseArgs } from "node:util";
import { enqueueJob, registerAwardJobs, registerJobHandler, runDueJobs } from "@sermo/core";
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
  registerJobHandler(env.ctx, "awards.sweep", (ctx, payload, job) => {
    const start = performance.now();
    sweepChunk(ctx, (payload as { after: number }).after, job);
    maxChunkMs = Math.max(maxChunkMs, performance.now() - start);
  });
}
async function drain(env: BenchEnv): Promise<void> {
  while (await runDueJobs(env.ctx, { limit: 1 }))
    await new Promise((resolve) => setImmediate(resolve));
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
      const page = (await env.call("awards.holders", env.actors.member(0), {
        awardId: env.meta.economy.stackableAwardIds[0]!,
        limit: 100,
      })) as { nextCursor: string | null };
      holdersCursor = page.nextCursor ?? undefined;
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
      const page = (await env.call(
        "awards.memberGrants",
        env.actors.user(env.meta.economy.awardHeavyUserId),
        { userId: env.meta.economy.awardHeavyUserId, limit: 100 },
      )) as { nextCursor: string | null };
      grantsCursor = page.nextCursor ?? undefined;
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
];
