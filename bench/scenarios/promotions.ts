import { enqueueJob, registerJobHandler, registerPromotionJobs, runDueJobs } from "@sermo/core";
import { sweepChunk } from "../../packages/core/src/modules/promotions";
import type { Scenario } from "../harness";

let running = false;
let background: Promise<void> | null = null;
let maxChunkMs = 0;
let coldReported = false;

function registerMeasuredSweep(ctx: Parameters<typeof runDueJobs>[0]): void {
  registerPromotionJobs(ctx);
  registerJobHandler(ctx, "promotions.sweep", (context, payload) => {
    const start = performance.now();
    sweepChunk(context, (payload as { after: number }).after);
    maxChunkMs = Math.max(maxChunkMs, performance.now() - start);
  });
}

async function drain(ctx: Parameters<typeof runDueJobs>[0]): Promise<void> {
  while (await runDueJobs(ctx, { limit: 10 }))
    await new Promise((resolve) => setImmediate(resolve));
}

export const scenarios: Scenario[] = [
  {
    name: "promotions.sweep (60,000 members, 50 promotions)",
    kind: "write",
    iterations: 3,
    budgetExempt: "promotion sweep",
    setup(env) {
      maxChunkMs = 0;
      coldReported = false;
      registerMeasuredSweep(env.ctx);
    },
    async run(env) {
      const start = performance.now();
      enqueueJob(env.ctx, "promotions.sweep", { after: 0 }, { uniqueKey: "promotions.sweep" });
      await drain(env.ctx);
      if (!coldReported) {
        console.log(
          `Cold promotion sweep: ${(performance.now() - start).toFixed(2)} ms; maximum chunk: ${maxChunkMs.toFixed(2)} ms`,
        );
        coldReported = true;
      }
    },
  },
  {
    name: "threads.list member during a promotion sweep",
    kind: "read",
    setup(env) {
      registerMeasuredSweep(env.ctx);
      running = true;
      background = (async () => {
        while (running) {
          enqueueJob(env.ctx, "promotions.sweep", { after: 0 }, { uniqueKey: "promotions.sweep" });
          await runDueJobs(env.ctx, { limit: 1 });
          await new Promise((resolve) => setImmediate(resolve));
        }
      })();
    },
    run(env) {
      return env.call("threads.list", env.actors.member(0), {
        nodeId: env.meta.forumIds[0]!,
        limit: 20,
      });
    },
    async teardown() {
      running = false;
      await background;
      background = null;
    },
  },
  {
    name: "promotions.apply",
    kind: "write",
    async run(env) {
      const userId = env.meta.memberIds[0]!;
      const promotionId = env.meta.promotionIds[0]!;
      const state = env.ctx.sqlite
        .prepare<{ state: string }, [number, number]>(
          "SELECT state FROM user_promotions WHERE user_id = ?1 AND promotion_id = ?2",
        )
        .get(userId, promotionId)?.state;
      return env.call("promotions.apply", env.actors.admin, {
        userId,
        promotionId,
        action: state === "exempt" ? "promote" : "exempt",
      });
    },
  },
  {
    name: "promotions.log",
    kind: "read",
    run(env) {
      return env.call("promotions.log", env.actors.admin, { limit: 20 });
    },
  },
];
