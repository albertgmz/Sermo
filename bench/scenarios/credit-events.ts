import { parseArgs } from "node:util";
import {
  type Ctx,
  consumeEvents,
  publishEvent,
  registerEventSubscriber,
  writeTx,
} from "@sermo/core";
import { handleCreditRuleEvent } from "../../packages/core/src/modules/credit-events/subscriber";
import type { BenchEnv, Scenario } from "../harness";

const BATCH = 10;
let eventTimes: number[] = [];
let background: Promise<void> | null = null;
let running = false;
let day = 0;
let threadId = 0;
let updateRuleId = 0;
let deleteRuleIds: number[] = [];

function totalRuns(defaultIterations: number): number {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: false,
    options: { iterations: { type: "string" } },
  });
  const iterations = Number(values.iterations) || defaultIterations;
  return iterations + Math.min(20, Math.ceil(iterations / 5));
}

function measuredEvent(ctx: Ctx, event: Parameters<typeof handleCreditRuleEvent>[1]): void {
  const start = performance.now();
  handleCreditRuleEvent(ctx, event);
  eventTimes.push(performance.now() - start);
}

function reportEvents(): void {
  eventTimes.sort((a, b) => a - b);
  const max = eventTimes.at(-1) ?? 0;
  const p95 = eventTimes[Math.max(0, Math.ceil(eventTimes.length * 0.95) - 1)] ?? 0;
  console.log(
    `Credit rules: ${eventTimes.length} events; single-event p95 ${p95.toFixed(2)} ms; largest transaction ${max.toFixed(2)} ms`,
  );
  if (p95 > 50 || max > 200)
    throw new Error("Credit-rule event transactions exceeded their budgets.");
}

function queueActivity(env: BenchEnv, count: number): void {
  // Distinct fixture days ensure each batch measures new payments, including with --reuse.
  writeTx(env.ctx, () => {
    for (let i = 0; i < count; i++)
      publishEvent(env.ctx, {
        type: "member.active_day",
        targetType: "user",
        targetId: env.meta.memberIds[i % env.meta.memberIds.length]!,
        payload: { day: day++ },
      });
  });
}

async function setupSubscriber(env: BenchEnv): Promise<void> {
  if (!env.meta.economy.ruleIds.length) throw new Error("The economy seed is required.");
  eventTimes = [];
  day = Math.floor(env.ctx.now() / 86_400_000);
  await env.call("creditRules.create", env.actors.admin, {
    title: "Benchmark daily payments",
    trigger: "daily_activity",
    amount: 1,
  });
  // Start this measurement after pre-existing work; only the new fixture events are timed.
  const last = env.ctx.sqlite
    .prepare<{ id: number }, []>("SELECT coalesce(max(id), 0) AS id FROM domain_events")
    .get()!.id;
  env.ctx.sqlite
    .prepare(
      "INSERT INTO event_subscribers (name, last_event_id, updated_at) VALUES ('credit-rules', ?1, ?2) ON CONFLICT(name) DO UPDATE SET last_event_id = excluded.last_event_id, updated_at = excluded.updated_at",
    )
    .run(last, env.ctx.now());
  registerEventSubscriber(env.ctx, "credit-rules", (event) => measuredEvent(env.ctx, event));
}

async function startBackground(env: BenchEnv): Promise<void> {
  await setupSubscriber(env);
  running = true;
  queueActivity(env, BATCH);
  background = (async () => {
    while (running) {
      const count = await consumeEvents(
        env.ctx,
        "credit-rules",
        (event) => measuredEvent(env.ctx, event),
        BATCH,
      );
      if (count < BATCH) queueActivity(env, BATCH);
      await new Promise((resolve) => setImmediate(resolve));
    }
  })();
}

async function stopBackground(): Promise<void> {
  running = false;
  await background;
  background = null;
  reportEvents();
}

export const scenarios: Scenario[] = [
  {
    name: "creditRules.list",
    kind: "read",
    run(env) {
      return env.call("creditRules.list", env.actors.admin, {});
    },
  },
  {
    name: "creditRules.create",
    kind: "write",
    run(env) {
      return env.call("creditRules.create", env.actors.admin, {
        title: "Benchmark forum rule",
        trigger: "reply_posted",
        amount: 2,
        nodeIds: [env.meta.forumIds[0]!],
        limit: { count: 10, windowHours: 24 },
        isActive: false,
      });
    },
  },
  {
    name: "creditRules.update",
    kind: "write",
    async setup(env) {
      const rule = JSON.parse(
        (await env.call("creditRules.create", env.actors.admin, {
          title: "Benchmark update rule",
          trigger: "registered",
          amount: 1,
          isActive: false,
        })) as string,
      ) as { id: number };
      updateRuleId = rule.id;
    },
    run(env) {
      const current = env.ctx.sqlite
        .prepare<{ amount: number }, [number]>("SELECT amount FROM credit_rules WHERE id = ?1")
        .get(updateRuleId)!;
      return env.call("creditRules.update", env.actors.admin, {
        ruleId: updateRuleId,
        amount: current.amount === 1 ? 2 : 1,
      });
    },
  },
  {
    name: "creditRules.delete",
    kind: "write",
    setup(env) {
      deleteRuleIds = [];
      const insert = env.ctx.sqlite.prepare(
        "INSERT INTO credit_rules (title, trigger, amount, is_active, created_at, updated_at) VALUES ('Benchmark deletion', 'registered', 1, 0, ?1, ?1)",
      );
      writeTx(env.ctx, () => {
        for (let i = 0; i < totalRuns(100); i++)
          deleteRuleIds.push(Number(insert.run(env.ctx.now()).lastInsertRowid));
      });
    },
    run(env) {
      return env.call("creditRules.delete", env.actors.admin, { ruleId: deleteRuleIds.pop()! });
    },
  },
  {
    name: "credit-events.consume batch (10 events)",
    kind: "write",
    iterations: 5,
    async setup(env) {
      await setupSubscriber(env);
      for (let i = 0; i < totalRuns(5); i++) queueActivity(env, BATCH);
    },
    run(env) {
      return consumeEvents(
        env.ctx,
        "credit-rules",
        (event) => measuredEvent(env.ctx, event),
        BATCH,
      );
    },
    teardown() {
      reportEvents();
    },
  },
  {
    name: "credit-events threads.list while consuming",
    kind: "read",
    setup: startBackground,
    run(env) {
      return env.call("threads.list", env.actors.member(0), {
        nodeId: env.meta.forumIds[0]!,
        limit: 20,
      });
    },
    teardown: stopBackground,
  },
  {
    name: "credit-events posts.create while consuming",
    kind: "write",
    async setup(env) {
      const result = JSON.parse(
        (await env.call("threads.create", env.actors.admin, {
          nodeId: env.meta.forumIds[0]!,
          title: "Credit rule benchmark replies",
          body: "Benchmark thread.",
        })) as string,
      ) as { thread: { id: number } };
      threadId = result.thread.id;
      await startBackground(env);
    },
    run(env, i) {
      return env.call("posts.create", env.actors.member(0), {
        threadId,
        body: `Credit rule benchmark reply ${i}.`,
      });
    },
    teardown: stopBackground,
  },
];
