import { expect, test } from "bun:test";
import { createTestContext, insertNode, insertUser, userActor } from "@sermo/core/testing";
import { execute } from "../../operation";
import { threadsCreateOp } from "../forums";
import { runHourlyTasks } from "./scheduler";

test("hourly maintenance gives queued work a turn before credential cleanup", async () => {
  const ctx = createTestContext();
  ctx.sqlite.exec(
    "WITH RECURSIVE n(id) AS (SELECT 1 UNION ALL SELECT id + 1 FROM n WHERE id < 2501) " +
      "INSERT INTO auth_verification (identifier, value, expires_at, created_at, updated_at) " +
      "SELECT 'expired-' || id, 'x', 1, 1, 1 FROM n",
  );
  const remaining = () =>
    ctx.sqlite.prepare<{ n: number }, []>("SELECT count(*) AS n FROM auth_verification").get()!.n;
  let beforeCleanup = -1;
  const tick = new Promise<void>((resolve) => {
    setImmediate(() => {
      beforeCleanup = remaining();
      resolve();
    });
  });
  try {
    await runHourlyTasks(ctx);
    await tick;
    expect(beforeCleanup).toBe(2501);
    expect(remaining()).toBe(0);
  } finally {
    ctx.sqlite.close(true);
  }
});

test.each([
  { total: 0, batches: 1 },
  { total: 1000, batches: 1 },
  { total: 2501, batches: 3 },
])(
  "hourly maintenance yields between credential batches: $total rows",
  async ({ total, batches }) => {
    const ctx = createTestContext();
    let remaining = total;
    let ticks = 0;
    let running = true;
    const turns: number[] = [];
    const tick = () => {
      ticks++;
      if (running) setImmediate(tick);
    };
    setImmediate(tick);
    try {
      await runHourlyTasks(ctx, () => {
        turns.push(ticks);
        const removed = Math.min(1000, remaining);
        remaining -= removed;
        return { sessions: 0, apiKeys: 0, verifications: removed, more: remaining > 0 };
      });
      expect(remaining).toBe(0);
      expect(turns).toHaveLength(batches);
      expect(turns[0]).toBeGreaterThan(0);
      for (let i = 1; i < turns.length; i++) expect(turns[i]!).toBeGreaterThan(turns[i - 1]!);
    } finally {
      running = false;
      ctx.sqlite.close(true);
    }
  },
);

test("hourly maintenance yields to the event loop between full batches", async () => {
  const ctx = createTestContext();
  const author = insertUser(ctx);
  const forum = insertNode(ctx, {});
  const made = await execute(ctx, threadsCreateOp, userActor(author), {
    nodeId: forum.id,
    title: "Busy",
    body: "body",
  });
  ctx.sqlite.prepare("DELETE FROM thread_reads").run();
  const insertRead = ctx.sqlite.prepare(
    "INSERT INTO thread_reads (user_id, thread_id, last_read_post_id, last_read_position, read_at) VALUES (?1, ?2, ?3, 0, ?4)",
  );
  for (let i = 0; i < 2500; i++)
    insertRead.run(insertUser(ctx).id, made.thread.id, made.post.id, ctx.now());

  let ticks = 0;
  let running = true;
  const tick = () => {
    ticks++;
    if (running) setImmediate(tick);
  };
  setImmediate(tick);
  await runHourlyTasks(ctx);
  running = false;

  // 2500 markers are three batches, so the loop yielded after each of the two full ones.
  expect(ticks).toBeGreaterThanOrEqual(2);
  expect(
    ctx.sqlite.prepare<{ n: number }, []>("SELECT COUNT(*) AS n FROM thread_reads").get()?.n,
  ).toBe(2500);
});

test("credential cleanup carries the scan cursor across batches of live rows", async () => {
  const ctx = createTestContext();
  const cursors: unknown[] = [];
  try {
    await runHourlyTasks(ctx, (_ctx, after) => {
      cursors.push(after);
      return {
        sessions: 0,
        apiKeys: 0,
        verifications: 0,
        after: { sessions: 0, apiKeys: 0, verifications: cursors.length * 1000 },
        more: cursors.length < 3,
      };
    });
    expect(cursors).toEqual([
      undefined,
      { sessions: 0, apiKeys: 0, verifications: 1000 },
      { sessions: 0, apiKeys: 0, verifications: 2000 },
    ]);
  } finally {
    ctx.sqlite.close(true);
  }
});
