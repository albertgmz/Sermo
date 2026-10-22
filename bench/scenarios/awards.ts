import { closeSync, copyFileSync, openSync, readSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  type Ctx,
  closeContext,
  createContext,
  dispatchEvents,
  enqueueJob,
  registerAwardJobs,
  registerJobHandler,
  runDueJobs,
  startCheckpointer,
  startJobWorker,
} from "@sermo/core";
import { sweepChunk } from "../../packages/core/src/modules/awards/automatic";
import { rebuildChunk } from "../../packages/core/src/modules/awards/rebuild";
import { revokeChunk } from "../../packages/core/src/modules/awards/revoke";
import type { ClaimedJob } from "../../packages/core/src/modules/jobs/queue";
import { type BenchEnv, createEnv, type Scenario } from "../harness";
import { Rng } from "../rng";
import { benchDir, seedPaths } from "../seed";

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
async function createScaleAwards(env: BenchEnv): Promise<number[]> {
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
  registerJobHandler(
    env.ctx,
    "awards.sweep",
    async (ctx, payload, job) => {
      const start = performance.now();
      await sweepChunk(ctx, (payload as { after: number }).after, job);
      maxChunkMs = Math.max(maxChunkMs, performance.now() - start);
    },
    { holdCheckpoints: false },
  );
}
async function drain(env: BenchEnv): Promise<void> {
  while (await runDueJobs(env.ctx, { limit: 1 }))
    await new Promise((resolve) => setImmediate(resolve));
}

type ScaleRun = {
  env: BenchEnv;
  work: ScaleWork;
  started: number;
  chunks: number[];
  lagMs: number;
  walBytes: number;
  relay: ReturnType<typeof Bun.serve>;
  stop: () => Promise<void>;
};
let scale: ScaleRun | null = null;

/** A background run measured on its own copy of the seed, as the server runs it. */
type ScaleWork = {
  /** What the report calls it. */
  label: string;
  /** The job type that carries it, and the chunk it runs. */
  job: string;
  chunk(ctx: Ctx, payload: unknown, job: ClaimedJob): Promise<unknown>;
  /** Makes the data the run works on, once the copy has its awards. */
  prepare?(copy: BenchEnv, awardIds: number[]): Promise<void>;
  /** Queues the first chunk. */
  start(copy: BenchEnv): void | Promise<void>;
  /** True once the whole run is done. */
  finished(copy: BenchEnv): boolean;
  /** What the run did, for the report. */
  summary?(copy: BenchEnv): string;
};

/**
 * Reads the copy once so the OS page cache holds it, as `bench/run.ts` does for its own copy: a
 * server that has been running has its database in memory, and a fresh copy (a new file to the
 * file system, even when it shares the seed's blocks) is read from disk on first use, so a run
 * over every member would otherwise measure disk reads of pages nothing has touched yet.
 */
function warmFileCache(path: string): void {
  const fd = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(8 * 1024 * 1024);
  while (readSync(fd, buffer, 0, buffer.length, null) > 0) {}
  closeSync(fd);
}

/**
 * Runs a background job over every member against about a hundred awards as the server does: the
 * job worker polls the queue and events are dispatched every second, on the thread that serves
 * requests. It runs on its own copy of the seed, so the awards, the grants, the events, the
 * replies and the run left unfinished never reach another scenario. Measuring starts once the
 * first chunk is done.
 */
async function startScale(env: BenchEnv, work: ScaleWork): Promise<void> {
  const path = join(benchDir(), `award-sweep-${process.pid}.db`);
  for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
  copyFileSync(seedPaths().db, path);
  warmFileCache(path);
  const ctx: Ctx = createContext({ path, config: env.ctx.config });
  const stopCheckpointer = startCheckpointer(ctx);
  const copy = await createEnv(ctx, env.meta, new Rng(42));
  const awardIds = await createScaleAwards(copy);
  await work.prepare?.(copy, awardIds);
  // The award subscriber starts after the seeded history: it judges what this run publishes.
  ctx.sqlite
    .prepare(
      "INSERT INTO event_subscribers (name, last_event_id, updated_at) VALUES ('awards', (SELECT coalesce(max(id), 0) FROM domain_events), ?1) " +
        "ON CONFLICT (name) DO UPDATE SET last_event_id = excluded.last_event_id, updated_at = excluded.updated_at",
    )
    .run(ctx.now());
  registerAwardJobs(ctx);
  const chunks: number[] = [];
  registerJobHandler(
    ctx,
    work.job,
    async (context, payload, job) => {
      const start = performance.now();
      await work.chunk(context, payload, job);
      chunks.push(performance.now() - start);
    },
    { holdCheckpoints: false },
  );
  let last = performance.now();
  const lag = setInterval(() => {
    const now = performance.now();
    run.lagMs = Math.max(run.lagMs, now - last - 5);
    last = now;
  }, 5);
  const wal = setInterval(() => {
    try {
      run.walBytes = Math.max(run.walBytes, statSync(`${path}-wal`).size);
    } catch {}
  }, 100);
  let dispatching: Promise<unknown> | null = null;
  const events = setInterval(() => {
    dispatching ??= dispatchEvents(ctx).finally(() => {
      dispatching = null;
    });
  }, 1000);
  const stopWorker = startJobWorker(ctx);
  const relay = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const call = (await request.json()) as { operation: string; userId: number; input: unknown };
      return new Response(
        String(await copy.call(call.operation, copy.actors.user(call.userId), call.input)),
      );
    },
  });
  const run: ScaleRun = {
    env: copy,
    work,
    started: performance.now(),
    chunks,
    lagMs: 0,
    walBytes: 0,
    relay,
    async stop() {
      clearInterval(events);
      await stopWorker();
      await dispatching;
      clearInterval(lag);
      clearInterval(wal);
      await relay.stop(true);
      await stopCheckpointer();
      closeContext(ctx);
      for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
    },
  };
  scale = run;
  await work.start(copy);
  while (chunks.length === 0) await new Promise((resolve) => setTimeout(resolve, 10));
}

/** Stops the run and reports it; with `untilDone`, waits (at most ten minutes) for its end first. */
async function stopScale(untilDone = false): Promise<void> {
  const run = scale;
  if (!run) return;
  scale = null;
  const deadline = performance.now() + 600_000;
  while (untilDone && !run.work.finished(run.env) && performance.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 500));
  const left = !run.work.finished(run.env);
  const elapsed = (performance.now() - run.started) / 1000;
  const summary = run.work.summary?.(run.env);
  await run.stop();
  const sorted = run.chunks.toSorted((a, b) => a - b);
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
  console.log(
    `${run.work.label} at scale: ${sorted.length} chunks in ${elapsed.toFixed(1)} s${left ? " (stopped before the end)" : ""}, ` +
      `chunk p95 ${p95.toFixed(2)} ms, max ${(sorted.at(-1) ?? 0).toFixed(2)} ms; longest event-loop stall ${run.lagMs.toFixed(2)} ms; ` +
      `largest WAL ${(run.walBytes / 1e6).toFixed(1)} MB${summary ? `; ${summary}` : ""}`,
  );
}

const sweepWork: ScaleWork = {
  label: "Award sweep",
  job: "awards.sweep",
  chunk: (ctx, payload, job) => sweepChunk(ctx, (payload as { after: number }).after, job),
  start: (copy) => {
    enqueueJob(copy.ctx, "awards.sweep", { after: 0 }, { uniqueKey: "awards.sweep" });
  },
  finished: (copy) =>
    copy.ctx.sqlite
      .prepare<{ n: number }, []>(
        "SELECT count(*) AS n FROM jobs WHERE unique_key = 'awards.sweep'",
      )
      .get()!.n === 0,
};

/**
 * What a live site has when the administrator takes back the awards of those who no longer
 * qualify: about 950,000 automatic grants (the seed has some 60,000 members; each holds one award
 * of every seven), judged against the real rules of the scale awards, so most fall and some hold,
 * and awards that read other awards cascade. The totals, XP and counts are made to match, as the
 * grants would have left them.
 */
function grantAtLiveScale(copy: BenchEnv, awardIds: number[]): void {
  const db = copy.ctx.sqlite;
  const ids = JSON.stringify(awardIds);
  const { first, last } = db
    .prepare<{ first: number; last: number }, []>(
      "SELECT min(id) AS first, max(id) AS last FROM users",
    )
    .get()!;
  const insert = db.prepare(
    "INSERT INTO member_awards (user_id, award_id, granted_by, reason, xp, credits, created_at) " +
      "SELECT u.id, a.id, NULL, '', a.xp, a.credits, ?1 FROM users u JOIN awards a ON a.id IN (SELECT value FROM json_each(?2)) " +
      "WHERE u.id BETWEEN ?3 AND ?4 AND (u.id * 7 + a.id) % 7 = 0",
  );
  const step = 2000;
  for (let from = first; from <= last; from += step)
    db.transaction(() => insert.run(copy.ctx.now(), ids, from, from + step - 1))();
  db.transaction(() => {
    db.prepare(
      "INSERT INTO member_award_totals (user_id, award_id, count, auto_granted, last_granted_at) " +
        "SELECT user_id, award_id, 1, 1, created_at FROM member_awards WHERE award_id IN (SELECT value FROM json_each(?1)) AND revoked_at IS NULL " +
        "ON CONFLICT (user_id, award_id) DO UPDATE SET count = count + 1, auto_granted = 1",
    ).run(ids);
    db.prepare(
      "UPDATE users SET award_xp = award_xp + coalesce((SELECT sum(xp) FROM member_awards g WHERE g.user_id = users.id AND g.revoked_at IS NULL AND g.award_id IN (SELECT value FROM json_each(?1))), 0), " +
        "award_count = award_count + (SELECT count(*) FROM member_awards g WHERE g.user_id = users.id AND g.revoked_at IS NULL AND g.award_id IN (SELECT value FROM json_each(?1)))",
    ).run(ids);
    db.prepare(
      "UPDATE awards SET grant_count = (SELECT count(*) FROM member_awards g WHERE g.award_id = awards.id AND g.revoked_at IS NULL) WHERE id IN (SELECT value FROM json_each(?1))",
    ).run(ids);
  })();
}

const revokeWork: ScaleWork = {
  label: "Award revoke",
  job: "awards.revoke",
  chunk: (ctx, payload, job) => revokeChunk(ctx, (payload as { after: number }).after, job),
  prepare: async (copy, awardIds) => {
    grantAtLiveScale(copy, awardIds);
  },
  start: async (copy) => {
    await copy.call("awards.revokeUnqualified", copy.actors.admin, { apply: true });
  },
  finished: (copy) =>
    copy.ctx.sqlite
      .prepare<{ n: number }, []>(
        "SELECT count(*) AS n FROM site_settings WHERE key = 'awards.revokeUnqualified' AND json_extract(value, '$.state') = 'running'",
      )
      .get()!.n === 0,
  summary: (copy) => {
    const record = copy.ctx.sqlite
      .prepare<{ value: string }, []>(
        "SELECT value FROM site_settings WHERE key = 'awards.revokeUnqualified'",
      )
      .get();
    const { grants, affected, members } = JSON.parse(record?.value ?? "{}") as Record<
      string,
      number
    >;
    const behind = copy.ctx.sqlite
      .prepare<{ n: number }, []>(
        "SELECT (SELECT coalesce(max(id), 0) FROM domain_events) - coalesce((SELECT last_event_id FROM event_subscribers WHERE name = 'awards'), 0) AS n",
      )
      .get()!.n;
    return `${grants} grants taken back from ${affected} of ${members} members seen; the awards subscriber is ${behind} events behind`;
  },
};

/** The same live-scale grants, rebuilt: judged again, the fallen taken back, the missing given. */
const rebuildWork: ScaleWork = {
  label: "Award rebuild",
  job: "awards.rebuild",
  chunk: (ctx, payload, job) => rebuildChunk(ctx, (payload as { after: number }).after, job),
  prepare: async (copy, awardIds) => {
    grantAtLiveScale(copy, awardIds);
  },
  start: async (copy) => {
    await copy.callInProcess("awards.rebuild", copy.actors.admin, {});
  },
  finished: (copy) =>
    copy.ctx.sqlite
      .prepare<{ n: number }, []>(
        "SELECT count(*) AS n FROM site_settings WHERE key = 'awards.rebuild' AND json_extract(value, '$.state') = 'running'",
      )
      .get()!.n === 0,
  summary: (copy) => {
    const record = copy.ctx.sqlite
      .prepare<{ value: string }, []>(
        "SELECT value FROM site_settings WHERE key = 'awards.rebuild'",
      )
      .get();
    const { granted, takenBack, levelsDown, members } = JSON.parse(record?.value ?? "{}") as Record<
      string,
      number
    >;
    return `${members} members seen, ${granted} grants made, ${takenBack} taken back, ${levelsDown} levels down`;
  },
};

/**
 * Sends one call to the sweep's copy over a local socket, as a visitor's request reaches the
 * server: it is served when the event loop next polls for input, so it waits for whatever
 * background work holds the loop when it arrives (a call made in process would slip in between
 * the work's own promises).
 */
async function overSocket(operation: string, userId: number, input: unknown) {
  const response = await fetch(scale!.relay.url, {
    method: "POST",
    body: JSON.stringify({ operation, userId, input }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${operation} -> ${response.status} ${text}`);
  return text;
}

/** A read, over a socket, while a background run works on its own copy of the seed. */
const readWhile = (name: string, work: ScaleWork): Scenario => ({
  name,
  kind: "read",
  iterations: 3000,
  setup: (env) => startScale(env, work),
  run: (env, i) =>
    overSocket("threads.list", env.meta.memberIds[i % env.meta.memberIds.length]!, {
      nodeId: env.meta.forumIds[0]!,
      limit: 20,
    }),
  teardown: () => stopScale(),
});
/** A write, over a socket, while a background run works; `untilDone` waits for the run's end. */
const writeWhile = (name: string, work: ScaleWork, untilDone = false): Scenario => ({
  name,
  kind: "write",
  iterations: 1000,
  setup: (env) => startScale(env, work),
  run: (env, i) =>
    overSocket("posts.create", env.meta.memberIds[i % env.meta.memberIds.length]!, {
      threadId: env.meta.threadIds[0]!,
      body: `Reply while the ${work.label.toLowerCase()} runs ${i}.`,
    }),
  teardown: () => stopScale(untilDone),
});

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
    name: "awards.revokeStatus",
    kind: "read",
    run: (env) => env.call("awards.revokeStatus", env.actors.admin, {}),
  },
  {
    // The first call queues the count; the others find it queued.
    name: "awards.revokeUnqualified",
    kind: "write",
    iterations: WRITE_ITERATIONS,
    run: (env) => env.call("awards.revokeUnqualified", env.actors.admin, { apply: false }),
    teardown(env) {
      env.ctx.sqlite.run("DELETE FROM jobs WHERE type = 'awards.revoke'");
      env.ctx.sqlite.run("DELETE FROM site_settings WHERE key = 'awards.revokeUnqualified'");
    },
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
  readWhile("awards sweep at scale: threads.list while it runs", sweepWork),
  writeWhile("awards sweep at scale: posts.create while it runs", sweepWork),
  // About 950,000 automatic grants, taken back in chunks while visitors read and write; the
  // second also waits for the run to end (at most ten minutes) and reports how long it took.
  readWhile("awards revoke at scale: threads.list while it runs", revokeWork),
  writeWhile("awards revoke at scale: posts.create while it runs", revokeWork, true),
  // The whole rebuild: every member judged, so one chunk is 25 members (fewer when they need much).
  readWhile("awards rebuild at scale: threads.list while it runs", rebuildWork),
  writeWhile("awards rebuild at scale: posts.create while it runs", rebuildWork, true),
];
