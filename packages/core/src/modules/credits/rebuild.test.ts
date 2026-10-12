import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertUser } from "@sermo/core/testing";
import { closeContext } from "../../context";
import { writeTx } from "../../db/tx";
import { moveCredits } from "../../shared/credits";
import { enqueueJob, runDueJobs } from "../jobs/queue";
import { registerCreditJobs } from "./index";
import { CREDIT_RECALCULATE_CHUNK_SIZE, recalculateCreditsChunk } from "./rebuild";

const contexts: ReturnType<typeof createTestContext>[] = [];
function setup() {
  const ctx = createTestContext();
  contexts.push(ctx);
  registerCreditJobs(ctx);
  return ctx;
}
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});
const enqueue = (ctx: ReturnType<typeof setup>) =>
  enqueueJob(ctx, "credits.recalculate", { after: 0 }, { uniqueKey: "credits.recalculate" });
const balances = (ctx: ReturnType<typeof setup>) =>
  ctx.sqlite.prepare("SELECT id, credits FROM users ORDER BY id").all();
const ledger = (ctx: ReturnType<typeof setup>) =>
  ctx.sqlite.prepare("SELECT * FROM credit_transactions ORDER BY id").all();

describe("credit balance rebuild", () => {
  test("repairs in bounded chunks, preserves the ledger, and skips matching counters", async () => {
    const ctx = setup();
    const members = writeTx(ctx, () => Array.from({ length: 205 }, () => insertUser(ctx)));
    writeTx(ctx, () =>
      moveCredits(ctx, [
        { userId: members[0]!.id, amount: 25, type: "event" },
        { userId: members[0]!.id, amount: -5, type: "purchase" },
        { userId: members[1]!.id, amount: -30, type: "adjustment" },
        { userId: members[204]!.id, amount: 90, type: "award" },
      ]),
    );
    const expected = balances(ctx);
    const before = ledger(ctx);
    const eventsBefore = ctx.sqlite.prepare("SELECT * FROM domain_events").all();
    ctx.sqlite.prepare("UPDATE users SET credits = 123 WHERE id != ?1").run(members[1]!.id);
    ctx.sqlite.exec(
      "CREATE TEMP TABLE balance_updates (user_id INTEGER); CREATE TEMP TRIGGER track_balance_updates AFTER UPDATE OF credits ON users BEGIN INSERT INTO balance_updates VALUES (new.id); END",
    );
    const id = enqueue(ctx)!;
    expect(await runDueJobs(ctx, { limit: 1 })).toBe(1);
    const repaired = ctx.sqlite.prepare("SELECT user_id FROM balance_updates").all();
    expect(repaired.length).toBe(CREDIT_RECALCULATE_CHUNK_SIZE - 1);
    expect(ctx.sqlite.prepare("SELECT status, unique_key FROM jobs WHERE id = ?1").get(id)).toEqual(
      { status: "done", unique_key: null },
    );
    const next = ctx.sqlite
      .prepare<{ payload: string }, []>(
        "SELECT payload FROM jobs WHERE unique_key = 'credits.recalculate'",
      )
      .get()!;
    expect(JSON.parse(next.payload).after).toBe(members[repaired.length]!.id);
    expect(enqueue(ctx)).toBeNull();
    while (await runDueJobs(ctx, { limit: 1 })) {}
    expect(balances(ctx)).toEqual(expected);
    expect(ledger(ctx)).toEqual(before);
    expect(ctx.sqlite.prepare("SELECT * FROM domain_events").all()).toEqual(eventsBefore);
    expect(ctx.sqlite.prepare("SELECT user_id FROM balance_updates").all()).toHaveLength(204);
    expect(ctx.sqlite.prepare("SELECT id FROM jobs WHERE status != 'done'").all()).toEqual([]);
    enqueue(ctx);
    while (await runDueJobs(ctx, { limit: 1 })) {}
    expect(ctx.sqlite.prepare("SELECT user_id FROM balance_updates").all()).toHaveLength(204);
  });

  test("reads the current ledger in each transaction, including adjustments between chunks", async () => {
    const ctx = setup();
    const members = writeTx(ctx, () => Array.from({ length: 205 }, () => insertUser(ctx)));
    ctx.sqlite.prepare("UPDATE users SET credits = 10 WHERE id = ?1").run(members[204]!.id);
    enqueue(ctx);
    await runDueJobs(ctx, { limit: 1 });
    writeTx(ctx, () =>
      moveCredits(ctx, [
        { userId: members[0]!.id, amount: 5, type: "adjustment" },
        { userId: members[204]!.id, amount: -6, type: "adjustment" },
      ]),
    );
    while (await runDueJobs(ctx, { limit: 1 })) {}
    expect(
      ctx.sqlite.prepare("SELECT credits FROM users WHERE id = ?1").get(members[0]!.id),
    ).toEqual({ credits: 5 });
    expect(
      ctx.sqlite.prepare("SELECT credits FROM users WHERE id = ?1").get(members[204]!.id),
    ).toEqual({ credits: -6 });
  });

  test("a failed continuation rolls back repairs and completion before retrying", async () => {
    const ctx = setup();
    writeTx(ctx, () => {
      for (let i = 0; i < 205; i++) insertUser(ctx);
      ctx.sqlite.exec("UPDATE users SET credits = 42");
    });
    const id = enqueue(ctx)!;
    ctx.sqlite.exec(
      "CREATE TEMP TRIGGER reject_credit_continuation BEFORE INSERT ON jobs WHEN new.type = 'credits.recalculate' BEGIN SELECT RAISE(ABORT, 'continuation failed'); END",
    );
    await runDueJobs(ctx, { limit: 1 });
    expect(ctx.sqlite.prepare("SELECT DISTINCT credits FROM users").all()).toEqual([
      { credits: 42 },
    ]);
    expect(
      ctx.sqlite.prepare("SELECT id, status, payload, unique_key, last_error FROM jobs").all(),
    ).toEqual([
      {
        id,
        status: "pending",
        payload: '{"after":0}',
        unique_key: "credits.recalculate",
        last_error: "continuation failed",
      },
    ]);
    ctx.sqlite.exec("DROP TRIGGER reject_credit_continuation");
    ctx.clock.advance(30_000);
    while (await runDueJobs(ctx, { limit: 1 })) {}
    expect(ctx.sqlite.prepare("SELECT DISTINCT credits FROM users").all()).toEqual([
      { credits: 0 },
    ]);
    expect(ledger(ctx)).toEqual([]);
  });

  test("an empty database completes without a continuation", async () => {
    const ctx = setup();
    enqueue(ctx);
    expect(await runDueJobs(ctx, { limit: 5 })).toBe(1);
    expect(ctx.sqlite.prepare("SELECT status, unique_key FROM jobs").all()).toEqual([
      { status: "done", unique_key: null },
    ]);
  });

  test("an exactly full chunk finishes on the following empty page", async () => {
    const ctx = setup();
    writeTx(ctx, () => {
      for (let i = 0; i < CREDIT_RECALCULATE_CHUNK_SIZE; i++) insertUser(ctx);
    });
    enqueue(ctx);
    expect(await runDueJobs(ctx, { limit: 5 })).toBe(2);
    expect(ctx.sqlite.prepare("SELECT status, unique_key FROM jobs").all()).toEqual([
      { status: "done", unique_key: null },
      { status: "done", unique_key: null },
    ]);
  });

  test("stale and repeated job claims cannot write or queue a continuation", () => {
    const ctx = setup();
    const member = insertUser(ctx);
    ctx.sqlite.prepare("UPDATE users SET credits = 4 WHERE id = ?1").run(member.id);
    const id = enqueue(ctx)!;
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'running', locked_until = 200 WHERE id = ?1")
      .run(id);
    expect(recalculateCreditsChunk(ctx, { after: 0 }, { id, lockedUntil: 100 })).toBe(0);
    expect(ctx.sqlite.prepare("SELECT credits FROM users WHERE id = ?1").get(member.id)).toEqual({
      credits: 4,
    });
    expect(recalculateCreditsChunk(ctx, { after: 0 }, { id, lockedUntil: 200 })).toBe(1);
    writeTx(ctx, () => moveCredits(ctx, [{ userId: member.id, amount: 8, type: "event" }]));
    expect(recalculateCreditsChunk(ctx, { after: 0 }, { id, lockedUntil: 200 })).toBe(0);
    expect(ctx.sqlite.prepare("SELECT credits FROM users WHERE id = ?1").get(member.id)).toEqual({
      credits: 8,
    });
    expect(ctx.sqlite.prepare("SELECT status FROM jobs").all()).toEqual([{ status: "done" }]);
  });

  test("malformed progress cannot complete a job or repair balances", () => {
    const ctx = setup();
    const member = insertUser(ctx);
    ctx.sqlite.prepare("UPDATE users SET credits = 4 WHERE id = ?1").run(member.id);
    const id = enqueue(ctx)!;
    ctx.sqlite
      .prepare("UPDATE jobs SET status = 'running', locked_until = 200 WHERE id = ?1")
      .run(id);
    for (const payload of [null, {}, { after: -1 }, { after: 0.5 }, { after: "0" }])
      expect(() => recalculateCreditsChunk(ctx, payload, { id, lockedUntil: 200 })).toThrow();
    expect(ctx.sqlite.prepare("SELECT credits FROM users WHERE id = ?1").get(member.id)).toEqual({
      credits: 4,
    });
    expect(ctx.sqlite.prepare("SELECT status FROM jobs").all()).toEqual([{ status: "running" }]);
  });
});
