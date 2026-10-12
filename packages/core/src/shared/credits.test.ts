import { describe, expect, test } from "bun:test";
import type { Ctx } from "../context";
import { writeTx } from "../db/tx";
import { ConflictError, NotFoundError } from "../errors";
import { createTestContext, insertUser } from "../testing";
import { moveCredits } from "./credits";

interface LedgerRow {
  id: number;
  user_id: number;
  amount: number;
  balance_after: number;
  type: string;
  source_type: string | null;
  source_id: number | null;
  actor_id: number | null;
  reason: string;
  created_at: number;
}

const balance = (ctx: Ctx, userId: number) =>
  ctx.sqlite
    .prepare<{ credits: number }, [number]>("SELECT credits FROM users WHERE id = ?1")
    .get(userId)!.credits;
const ledger = (ctx: Ctx, userId?: number) =>
  userId === undefined
    ? ctx.sqlite.prepare<LedgerRow, []>("SELECT * FROM credit_transactions ORDER BY id").all()
    : ctx.sqlite
        .prepare<LedgerRow, [number]>(
          "SELECT * FROM credit_transactions WHERE user_id = ?1 ORDER BY id",
        )
        .all(userId);
const events = (ctx: Ctx) =>
  ctx.sqlite
    .prepare<{ type: string; target_type: string; target_id: number; payload: string }, []>(
      "SELECT type, target_type, target_id, payload FROM domain_events WHERE type = 'credits.changed' ORDER BY id",
    )
    .all();

describe("moveCredits", () => {
  test("writes the balance and a ledger row with the resulting balance together", () => {
    const ctx = createTestContext();
    const user = insertUser(ctx);
    ctx.clock.set(1_234_567);
    const [first] = writeTx(ctx, () =>
      moveCredits(ctx, [
        {
          userId: user.id,
          amount: 50,
          type: "adjustment",
          source: { type: "manual", id: 7 },
          actorId: 99,
          reason: "welcome",
        },
      ]),
    );
    expect(first).toMatchObject({ userId: user.id, balance: 50 });
    const [second] = writeTx(ctx, () =>
      moveCredits(ctx, [{ userId: user.id, amount: -20, type: "purchase" }]),
    );
    expect(second!.balance).toBe(30);
    expect(balance(ctx, user.id)).toBe(30);
    expect(ledger(ctx, user.id)).toEqual([
      {
        id: first!.transactionId,
        user_id: user.id,
        amount: 50,
        balance_after: 50,
        type: "adjustment",
        source_type: "manual",
        source_id: 7,
        actor_id: 99,
        reason: "welcome",
        created_at: 1_234_567,
      },
      {
        id: second!.transactionId,
        user_id: user.id,
        amount: -20,
        balance_after: 30,
        type: "purchase",
        source_type: null,
        source_id: null,
        actor_id: null,
        reason: "",
        created_at: 1_234_567,
      },
    ]);
  });

  test("moves several members in one call and returns results in order", () => {
    const ctx = createTestContext();
    const [a, b, c] = [insertUser(ctx), insertUser(ctx), insertUser(ctx)];
    writeTx(ctx, () => moveCredits(ctx, [{ userId: a.id, amount: 100, type: "adjustment" }]));
    const results = writeTx(ctx, () =>
      moveCredits(ctx, [
        { userId: a.id, amount: -40, type: "event", requireFunds: true },
        { userId: b.id, amount: 25, type: "event" },
        { userId: c.id, amount: 15, type: "event" },
        { userId: a.id, amount: -10, type: "event" },
      ]),
    );
    expect(results.map((r) => [r.userId, r.balance])).toEqual([
      [a.id, 60],
      [b.id, 25],
      [c.id, 15],
      [a.id, 50],
    ]);
    expect([balance(ctx, a.id), balance(ctx, b.id), balance(ctx, c.id)]).toEqual([50, 25, 15]);
    expect(new Set(results.map((r) => r.transactionId)).size).toBe(4);
  });

  test("requireFunds refuses an overdraft and the transaction leaves no partial effect", () => {
    const ctx = createTestContext();
    const a = insertUser(ctx);
    const b = insertUser(ctx);
    writeTx(ctx, () => moveCredits(ctx, [{ userId: b.id, amount: 10, type: "adjustment" }]));
    const ledgerBefore = ledger(ctx).length;
    const eventsBefore = events(ctx).length;
    expect(() =>
      writeTx(ctx, () =>
        moveCredits(ctx, [
          { userId: a.id, amount: 500, type: "adjustment" },
          { userId: b.id, amount: -11, type: "purchase", requireFunds: true },
        ]),
      ),
    ).toThrow(ConflictError);
    expect(balance(ctx, a.id)).toBe(0);
    expect(balance(ctx, b.id)).toBe(10);
    expect(ledger(ctx).length).toBe(ledgerBefore);
    expect(events(ctx).length).toBe(eventsBefore);
  });

  test("a refused charge leaves the balance untouched even when the caller catches it", () => {
    const ctx = createTestContext();
    const a = insertUser(ctx);
    writeTx(ctx, () => moveCredits(ctx, [{ userId: a.id, amount: 5, type: "adjustment" }]));
    writeTx(ctx, () => {
      expect(() =>
        moveCredits(ctx, [{ userId: a.id, amount: -6, type: "purchase", requireFunds: true }]),
      ).toThrow(ConflictError);
    });
    expect(balance(ctx, a.id)).toBe(5);
    expect(ledger(ctx, a.id)).toHaveLength(1);
  });

  test("without requireFunds the balance can go negative", () => {
    const ctx = createTestContext();
    const a = insertUser(ctx);
    const [result] = writeTx(ctx, () =>
      moveCredits(ctx, [{ userId: a.id, amount: -30, type: "adjustment" }]),
    );
    expect(result!.balance).toBe(-30);
    expect(balance(ctx, a.id)).toBe(-30);
    expect(ledger(ctx, a.id)[0]!.balance_after).toBe(-30);
    // A charge that requires funds is refused while the balance is negative.
    expect(() =>
      writeTx(ctx, () =>
        moveCredits(ctx, [{ userId: a.id, amount: -1, type: "purchase", requireFunds: true }]),
      ),
    ).toThrow(ConflictError);
  });

  test("requireFunds only guards charges: a payment is applied even if the balance stays negative", () => {
    const ctx = createTestContext();
    const a = insertUser(ctx);
    writeTx(ctx, () => moveCredits(ctx, [{ userId: a.id, amount: -30, type: "adjustment" }]));
    writeTx(ctx, () =>
      moveCredits(ctx, [{ userId: a.id, amount: 10, type: "adjustment", requireFunds: true }]),
    );
    expect(balance(ctx, a.id)).toBe(-20);
  });

  test("a charge of exactly the balance with requireFunds succeeds and ends at zero", () => {
    const ctx = createTestContext();
    const a = insertUser(ctx);
    writeTx(ctx, () => moveCredits(ctx, [{ userId: a.id, amount: 40, type: "adjustment" }]));
    const [result] = writeTx(ctx, () =>
      moveCredits(ctx, [{ userId: a.id, amount: -40, type: "purchase", requireFunds: true }]),
    );
    expect(result!.balance).toBe(0);
    expect(balance(ctx, a.id)).toBe(0);
  });

  test("an unknown member is NotFoundError, with or without requireFunds", () => {
    const ctx = createTestContext();
    for (const requireFunds of [false, true]) {
      expect(() =>
        writeTx(ctx, () =>
          moveCredits(ctx, [{ userId: 987_654, amount: 5, type: "adjustment", requireFunds }]),
        ),
      ).toThrow(NotFoundError);
    }
    expect(ledger(ctx)).toHaveLength(0);
  });

  test("an unknown member in a later movement rolls back the earlier ones", () => {
    const ctx = createTestContext();
    const a = insertUser(ctx);
    expect(() =>
      writeTx(ctx, () =>
        moveCredits(ctx, [
          { userId: a.id, amount: 5, type: "adjustment" },
          { userId: 987_654, amount: 5, type: "adjustment" },
        ]),
      ),
    ).toThrow(NotFoundError);
    expect(balance(ctx, a.id)).toBe(0);
    expect(ledger(ctx)).toHaveLength(0);
  });

  test("amount 0 or a non-integer amount throws and changes nothing", () => {
    const ctx = createTestContext();
    const a = insertUser(ctx);
    for (const amount of [0, 1.5, -0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 60]) {
      expect(() =>
        writeTx(ctx, () => moveCredits(ctx, [{ userId: a.id, amount, type: "adjustment" }])),
      ).toThrow();
    }
    expect(balance(ctx, a.id)).toBe(0);
    expect(ledger(ctx)).toHaveLength(0);
    expect(events(ctx)).toHaveLength(0);
  });

  test("calling outside a transaction throws", () => {
    const ctx = createTestContext();
    const a = insertUser(ctx);
    expect(() => moveCredits(ctx, [{ userId: a.id, amount: 5, type: "adjustment" }])).toThrow();
    expect(balance(ctx, a.id)).toBe(0);
  });

  test("an empty movement list does nothing", () => {
    const ctx = createTestContext();
    expect(writeTx(ctx, () => moveCredits(ctx, []))).toEqual([]);
  });

  test("publishes one credits.changed event per movement with the documented payload", () => {
    const ctx = createTestContext();
    const a = insertUser(ctx);
    const b = insertUser(ctx);
    const results = writeTx(ctx, () =>
      moveCredits(ctx, [
        {
          userId: a.id,
          amount: 12,
          type: "award",
          source: { type: "member_award", id: 3 },
          actorId: b.id,
        },
        { userId: b.id, amount: -4, type: "event_reversal" },
      ]),
    );
    const rows = events(ctx);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.type, r.target_type, r.target_id])).toEqual([
      ["credits.changed", "user", a.id],
      ["credits.changed", "user", b.id],
    ]);
    expect(JSON.parse(rows[0]!.payload)).toEqual({
      transactionId: results[0]!.transactionId,
      amount: 12,
      balance: 12,
      type: "award",
      sourceType: "member_award",
      sourceId: 3,
      actorId: b.id,
    });
    expect(JSON.parse(rows[1]!.payload)).toEqual({
      transactionId: results[1]!.transactionId,
      amount: -4,
      balance: -4,
      type: "event_reversal",
      sourceType: null,
      sourceId: null,
      actorId: null,
    });
  });

  test("the balance always equals the ledger sum and balance_after the running sum", () => {
    const ctx = createTestContext();
    const members = Array.from({ length: 5 }, () => insertUser(ctx));
    // Deterministic PRNG so a failure reproduces.
    let seed = 20_261_010;
    const random = () => {
      seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return seed / 4_294_967_296;
    };
    let refused = 0;
    for (let step = 0; step < 200; step += 1) {
      const count = 1 + Math.floor(random() * 3);
      const movements = Array.from({ length: count }, () => {
        const amount = (1 + Math.floor(random() * 80)) * (random() < 0.5 ? -1 : 1);
        return {
          userId: members[Math.floor(random() * members.length)]!.id,
          amount,
          type: "adjustment" as const,
          requireFunds: random() < 0.4,
        };
      });
      try {
        writeTx(ctx, () => moveCredits(ctx, movements));
      } catch (error) {
        expect(error).toBeInstanceOf(ConflictError);
        refused += 1;
      }
    }
    expect(refused).toBeGreaterThan(0);
    expect(ledger(ctx).length).toBeGreaterThan(100);
    for (const member of members) {
      let running = 0;
      for (const row of ledger(ctx, member.id)) {
        running += row.amount;
        expect(row.balance_after).toBe(running);
      }
      expect(balance(ctx, member.id)).toBe(running);
      expect(
        ctx.sqlite
          .prepare<{ s: number | null }, [number]>(
            "SELECT SUM(amount) AS s FROM credit_transactions WHERE user_id = ?1",
          )
          .get(member.id)!.s ?? 0,
      ).toBe(balance(ctx, member.id));
    }
    // Every ledger row has exactly one event.
    expect(events(ctx)).toHaveLength(ledger(ctx).length);
  });
});

test("a balance that would leave the exact integer range is refused", () => {
  const ctx = createTestContext();
  const user = insertUser(ctx);
  writeTx(ctx, () =>
    moveCredits(ctx, [{ userId: user.id, amount: Number.MAX_SAFE_INTEGER, type: "adjustment" }]),
  );
  expect(() =>
    writeTx(ctx, () => moveCredits(ctx, [{ userId: user.id, amount: 2, type: "adjustment" }])),
  ).toThrow(ConflictError);
  expect(balance(ctx, user.id)).toBe(Number.MAX_SAFE_INTEGER);
});
