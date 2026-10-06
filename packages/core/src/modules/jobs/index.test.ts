import { describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTestClock,
  createTestContext,
  expectNoTableScan,
  insertNode,
  insertUser,
  userActor,
} from "@sermo/core/testing";
import { closeContext, createContext } from "../../context";
import { writeTx } from "../../db/tx";
import { execute } from "../../operation";
import { threadsCreateOp } from "../forums";
import {
  completeRunningJob,
  enqueueJob,
  flushViewCounts,
  registerJobHandler,
  runDueJobs,
  startJobWorker,
} from "./index";
import { jobSql, LEASE_MS } from "./queue";

const row = (ctx: ReturnType<typeof createTestContext>, id: number) =>
  ctx.sqlite
    .prepare<
      {
        status: string;
        attempts: number;
        run_at: number;
        last_error: string | null;
        unique_key: string | null;
      },
      [number]
    >("SELECT status, attempts, run_at, last_error, unique_key FROM jobs WHERE id = ?1")
    .get(id)!;

describe("jobs", () => {
  test("enqueues, claims, runs, completes, deduplicates, and reuses key", async () => {
    const ctx = createTestContext();
    const seen: unknown[] = [];
    registerJobHandler(ctx, "sample", (_, payload) => {
      seen.push(payload);
    });
    const id = enqueueJob(ctx, "sample", { a: 1 }, { uniqueKey: "once" })!;
    expect(enqueueJob(ctx, "sample", { a: 2 }, { uniqueKey: "once" })).toBeNull();
    expect(await runDueJobs(ctx)).toBe(1);
    expect(seen).toEqual([{ a: 1 }]);
    expect(row(ctx, id)).toMatchObject({ status: "done", attempts: 1, unique_key: null });
    expect(enqueueJob(ctx, "sample", {}, { uniqueKey: "once" })).toBeNumber();
  });

  test("retries with capped exponential backoff, then fails; unknown type fails immediately", async () => {
    const ctx = createTestContext();
    registerJobHandler(ctx, "bad", () => {
      throw new Error("boom");
    });
    const id = enqueueJob(ctx, "bad", {}, { uniqueKey: "bad" })!;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const now = ctx.now();
      expect(await runDueJobs(ctx)).toBe(1);
      expect(row(ctx, id).attempts).toBe(attempt);
      if (attempt < 5) {
        expect(row(ctx, id)).toMatchObject({
          status: "pending",
          run_at: now + [30_000, 120_000, 600_000, 3_600_000][attempt - 1]!,
          unique_key: "bad",
        });
        expect(await runDueJobs(ctx)).toBe(0);
        ctx.clock.set(row(ctx, id).run_at);
      }
    }
    expect(row(ctx, id)).toMatchObject({ status: "failed", last_error: "boom", unique_key: null });
    const unknown = enqueueJob(ctx, "missing", {})!;
    expect(await runDueJobs(ctx)).toBe(1);
    expect(row(ctx, unknown)).toMatchObject({
      status: "failed",
      attempts: 1,
      last_error: "Unknown job type: missing",
    });
  });

  test("expired lease is reclaimed and two contexts cannot claim one live job", async () => {
    const path = join(tmpdir(), `sermo-jobs-${crypto.randomUUID()}.sqlite`);
    const clock = createTestClock();
    const first = createContext({ path, migrate: true, now: clock.now });
    const second = createContext({ path, now: clock.now });
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started!: () => void;
      const begun = new Promise<void>((resolve) => {
        started = resolve;
      });
      let calls = 0;
      registerJobHandler(first, "hold", async () => {
        calls++;
        started();
        await gate;
      });
      registerJobHandler(second, "hold", () => {
        calls++;
      });
      const id = enqueueJob(first, "hold", {})!;
      const running = runDueJobs(first);
      await begun;
      expect(await runDueJobs(second)).toBe(0);
      release();
      expect(await running).toBe(1);
      expect(calls).toBe(1);
      const stale = enqueueJob(first, "hold", {})!;
      first.sqlite
        .prepare("UPDATE jobs SET status = 'running', locked_until = ?1 WHERE id = ?2")
        .run(clock.now() - 1, stale);
      expect(await runDueJobs(second)).toBe(1);
      expect(
        second.sqlite
          .prepare<{ attempts: number }, [number]>("SELECT attempts FROM jobs WHERE id = ?1")
          .get(stale)?.attempts,
      ).toBe(1);
      expect(
        first.sqlite
          .prepare<{ status: string }, [number]>("SELECT status FROM jobs WHERE id = ?1")
          .get(id)?.status,
      ).toBe("done");
    } finally {
      closeContext(second);
      closeContext(first);
      for (const suffix of ["", "-wal", "-shm"])
        if (existsSync(path + suffix)) unlinkSync(path + suffix);
    }
  });

  test("view flush swaps the buffer before updating and preserves views added during the write", async () => {
    const ctx = createTestContext();
    const user = userActor(insertUser(ctx));
    const forum = insertNode(ctx, {});
    const thread = await execute(ctx, threadsCreateOp, user, {
      nodeId: forum.id,
      title: "T",
      body: "body",
    });
    const id = thread.thread.id;
    ctx.views.set(id, 3);
    const clear = ctx.views.clear.bind(ctx.views);
    ctx.views.clear = () => {
      clear();
      ctx.views.set(id, 2);
    };
    expect(flushViewCounts(ctx)).toBe(1);
    expect(ctx.views.get(id)).toBe(2);
    ctx.views.clear = clear;
    expect(flushViewCounts(ctx)).toBe(1);
    expect(
      ctx.sqlite
        .prepare<{ view_count: number }, [number]>("SELECT view_count FROM threads WHERE id = ?1")
        .get(id)?.view_count,
    ).toBe(5);
  });

  test("claim queries use the jobs status index", () => {
    const ctx = createTestContext();
    expectNoTableScan(ctx, jobSql.pending, [ctx.now()]);
    expectNoTableScan(ctx, jobSql.expired, [ctx.now()]);
  });

  test("expired leases take priority and stop after five attempts", async () => {
    const ctx = createTestContext();
    registerJobHandler(ctx, "sample", () => {});
    const pending = enqueueJob(ctx, "sample", {})!;
    const expired = enqueueJob(ctx, "sample", {}, { uniqueKey: "lease" })!;
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'running', attempts = 1, locked_until = ?1 WHERE id = ?2")
      .run(ctx.now() - 1, expired);
    expect(await runDueJobs(ctx, { limit: 1 })).toBe(1);
    expect(row(ctx, expired).status).toBe("done");
    expect(row(ctx, pending).status).toBe("pending");
    const exhausted = enqueueJob(ctx, "sample", {}, { uniqueKey: "exhausted" })!;
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'running', attempts = 5, locked_until = ?1 WHERE id = ?2")
      .run(ctx.now() - 1, exhausted);
    expect(await runDueJobs(ctx, { limit: 1 })).toBe(1);
    expect(row(ctx, exhausted)).toMatchObject({ status: "failed", attempts: 5, unique_key: null });
    expect(row(ctx, exhausted).last_error).toContain("Lease expired");
    expect(row(ctx, pending).status).toBe("done");
  });

  test("failure hooks run once per permanent failure, by error or by lease expiry", async () => {
    const ctx = createTestContext();
    const failures: { id: number; payload: unknown; error: string }[] = [];
    registerJobHandler(
      ctx,
      "hooked",
      () => {
        throw new Error("boom");
      },
      { onFailed: (_ctx, job) => failures.push(job) },
    );
    registerJobHandler(ctx, "plain", () => {
      throw new Error("plain");
    });
    const thrown = enqueueJob(ctx, "hooked", { n: 1 })!;
    const plain = enqueueJob(ctx, "plain", {})!;
    ctx.sqlite.prepare("UPDATE jobs SET attempts = 4").run();
    expect(await runDueJobs(ctx)).toBe(2);
    expect(row(ctx, plain).status).toBe("failed");
    expect(failures).toEqual([{ id: thrown, payload: { n: 1 }, error: "boom" }]);
    const leased = enqueueJob(ctx, "hooked", { n: 2 })!;
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'running', attempts = 5, locked_until = ?1 WHERE id = ?2")
      .run(ctx.now() - 1, leased);
    await runDueJobs(ctx);
    expect(row(ctx, leased).status).toBe("failed");
    expect(failures.at(-1)).toMatchObject({ id: leased, payload: { n: 2 } });
    expect(failures.at(-1)!.error).toContain("Lease expired");
    expect(failures).toHaveLength(2);
  });

  test("a running job completes itself with its chunk and frees its key for a successor", async () => {
    const ctx = createTestContext();
    const seen: number[] = [];
    registerJobHandler(ctx, "chain", (context, payload, job) => {
      const { n } = payload as { n: number };
      writeTx(context, () => {
        if (!completeRunningJob(context, job)) return;
        seen.push(n);
        if (n < 3) enqueueJob(context, "chain", { n: n + 1 }, { uniqueKey: "chain" });
      });
    });
    const first = enqueueJob(ctx, "chain", { n: 1 }, { uniqueKey: "chain" })!;
    await runDueJobs(ctx);
    expect(seen).toEqual([1, 2, 3]);
    expect(row(ctx, first)).toMatchObject({ status: "done", unique_key: null });
  });

  test("a run whose lease expired cannot complete the reclaimed job or its successor", async () => {
    const ctx = createTestContext();
    const gates: (() => void)[] = [];
    const outcomes: string[] = [];
    registerJobHandler(ctx, "chain", async (context, payload, job) => {
      const { n } = payload as { n: number };
      await new Promise<void>((resolve) => gates.push(resolve));
      writeTx(context, () => {
        if (!completeRunningJob(context, job)) {
          outcomes.push(`stale ${n}`);
          return;
        }
        outcomes.push(`ran ${n}`);
        if (n < 2) enqueueJob(context, "chain", { n: n + 1 }, { uniqueKey: "chain" });
      });
    });
    enqueueJob(ctx, "chain", { n: 1 }, { uniqueKey: "chain" });
    const stale = runDueJobs(ctx, { limit: 1 });
    expect(gates).toHaveLength(1);
    ctx.clock.set(ctx.now() + LEASE_MS + 1);
    // Another run reclaims the job, completes it and claims its successor under the same key.
    const reclaimed = runDueJobs(ctx, { limit: 2 });
    gates[1]!();
    while (gates.length < 3) await new Promise((resolve) => setTimeout(resolve, 1));
    gates[0]!();
    await stale;
    gates[2]!();
    await reclaimed;
    expect(outcomes).toEqual(["ran 1", "stale 1", "ran 2"]);
    expect(
      ctx.sqlite
        .prepare<{ n: number }, []>("SELECT count(*) AS n FROM jobs WHERE status != 'done'")
        .get()!.n,
    ).toBe(0);
  });

  test("worker registers built-in handlers and stops polling", async () => {
    const ctx = createTestContext();
    const id = enqueueJob(
      ctx,
      "rebuild-counters",
      { stage: "threads", after: 0 },
      { uniqueKey: "rebuild-counters" },
    )!;
    const stop = startJobWorker(ctx, { pollMs: 5 });
    try {
      for (let i = 0; i < 100 && row(ctx, id).status !== "done"; i++) await Bun.sleep(5);
      expect(row(ctx, id).status).toBe("done");
    } finally {
      stop();
    }
    registerJobHandler(ctx, "sample", () => {});
    const after = enqueueJob(ctx, "sample", {})!;
    await Bun.sleep(25);
    expect(row(ctx, after).status).toBe("pending");
  });
});
