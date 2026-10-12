import { afterEach, describe, expect, test } from "bun:test";
import { createTestContext, insertUser, tokenActor, userActor } from "@sermo/core/testing";
import { GUEST } from "../../actor";
import { closeContext } from "../../context";
import { writeTx } from "../../db/tx";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
} from "../../errors";
import { execute } from "../../operation";
import { getOperation } from "../../operations";
import { encodeCursor } from "../../pagination";
import { moveCredits } from "../../shared/credits";

const contexts: ReturnType<typeof createTestContext>[] = [];
function setup() {
  const ctx = createTestContext();
  contexts.push(ctx);
  return ctx;
}
afterEach(() => {
  for (const ctx of contexts.splice(0)) closeContext(ctx);
});
const op = (name: string) => getOperation(`credits.${name}`);

describe("credits history and ledger", () => {
  test("history is private to its member and pages by id, not timestamp", async () => {
    const ctx = setup();
    const member = insertUser(ctx);
    const other = insertUser(ctx);
    const staff = insertUser(ctx, { groupId: 4 });
    const [first, foreign, last] = writeTx(ctx, () =>
      moveCredits(ctx, [
        { userId: member.id, amount: 50, type: "event", source: { type: "post", id: 71 } },
        { userId: other.id, amount: 900, type: "adjustment", actorId: staff.id },
        {
          userId: member.id,
          amount: -70,
          type: "adjustment",
          actorId: staff.id,
          reason: "Correction",
        },
      ]),
    );
    const before = ctx.sqlite.prepare("SELECT total_changes() AS n").get();
    const page = await execute(ctx, op("history"), userActor(member), {
      limit: 1,
      userId: other.id,
    });
    expect(page.balance).toBe(-20);
    expect(page.items).toEqual([
      {
        id: last!.transactionId,
        userId: member.id,
        amount: -70,
        balanceAfter: -20,
        type: "adjustment",
        source: null,
        actor: { id: staff.id, username: staff.username },
        reason: "Correction",
        createdAt: new Date(ctx.now()).toISOString(),
      },
    ]);
    expect(page.nextCursor).toBe(encodeCursor([last!.transactionId]));
    const next = await execute(ctx, op("history"), tokenActor(member), {
      limit: 1,
      cursor: page.nextCursor,
    });
    expect(next.items).toEqual([
      {
        id: first!.transactionId,
        userId: member.id,
        amount: 50,
        balanceAfter: 50,
        type: "event",
        source: { type: "post", id: 71 },
        actor: null,
        reason: "",
        createdAt: new Date(ctx.now()).toISOString(),
      },
    ]);
    expect(next.nextCursor).toBeNull();
    expect(next.balance).toBe(-20);
    expect(ctx.sqlite.prepare("SELECT total_changes() AS n").get()).toEqual(before);
    const wrongOwner = await execute(ctx, op("history"), userActor(other), {
      cursor: page.nextCursor,
    });
    expect(wrongOwner.items.map((row: { id: number }) => row.id)).toEqual([foreign!.transactionId]);
  });

  test.each([2, 3, 4, 5])("every signed-in group %i can see its empty history", async (groupId) => {
    const ctx = setup();
    const actor = userActor(insertUser(ctx, { groupId }));
    expect(await execute(ctx, op("history"), actor, {})).toEqual({
      items: [],
      nextCursor: null,
      balance: 0,
    });
  });

  test("guests cannot read history and missing members are not found", async () => {
    const ctx = setup();
    await expect(execute(ctx, op("history"), GUEST, {})).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    await expect(
      execute(ctx, op("history"), userActor({ id: 999, groupId: 2 }), {}),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test.each([3, 4])(
    "staff group %i can page everyone's ledger or one member's",
    async (groupId) => {
      const ctx = setup();
      const actor = userActor(insertUser(ctx, { groupId }));
      const a = insertUser(ctx);
      const b = insertUser(ctx);
      const rows = writeTx(ctx, () =>
        moveCredits(ctx, [
          { userId: a.id, amount: 10, type: "event" },
          { userId: b.id, amount: 30, type: "event" },
          { userId: a.id, amount: -20, type: "event_reversal" },
        ]),
      );
      const page = await execute(ctx, op("ledger"), actor, { limit: 2 });
      expect(page.balance).toBeNull();
      expect(page.items.map((row: { id: number }) => row.id)).toEqual([
        rows[2]!.transactionId,
        rows[1]!.transactionId,
      ]);
      const next = await execute(ctx, op("ledger"), actor, { limit: 2, cursor: page.nextCursor });
      expect(next.items.map((row: { id: number }) => row.id)).toEqual([rows[0]!.transactionId]);
      expect(next.nextCursor).toBeNull();
      const own = await execute(ctx, op("ledger"), actor, { userId: a.id, limit: 1 });
      expect(own.balance).toBe(-10);
      expect(own.items.map((row: { id: number }) => row.id)).toEqual([rows[2]!.transactionId]);
      const ownNext = await execute(ctx, op("ledger"), actor, {
        userId: a.id,
        cursor: own.nextCursor,
      });
      expect(ownNext.items.map((row: { id: number }) => row.id)).toEqual([rows[0]!.transactionId]);
      expect(ownNext.nextCursor).toBeNull();
      await expect(execute(ctx, op("ledger"), actor, { userId: 999 })).rejects.toBeInstanceOf(
        NotFoundError,
      );
    },
  );

  test("ledger checks viewAny even for the caller's own ledger and unknown targets", async () => {
    const ctx = setup();
    const member = insertUser(ctx);
    for (const input of [{}, { userId: member.id }, { userId: 999 }]) {
      await expect(execute(ctx, op("ledger"), GUEST, input)).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );
      await expect(execute(ctx, op("ledger"), userActor(member), input)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
  });

  test("empty global ledger has no balance and invalid cursors are rejected", async () => {
    const ctx = setup();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    expect(await execute(ctx, op("ledger"), admin, {})).toEqual({
      items: [],
      nextCursor: null,
      balance: null,
    });
    for (const name of ["history", "ledger"])
      for (const cursor of [
        "invalid",
        encodeCursor([0]),
        encodeCursor([-1]),
        encodeCursor(["1"]),
        encodeCursor([1, 2]),
      ])
        await expect(execute(ctx, op(name), admin, { cursor })).rejects.toBeInstanceOf(
          ValidationError,
        );
  });

  test("new rows do not shift a cursor and missing actors use the shared summary fallback", async () => {
    const ctx = setup();
    const member = insertUser(ctx);
    const movements = writeTx(ctx, () =>
      moveCredits(ctx, [
        { userId: member.id, amount: 1, type: "event", actorId: 999 },
        { userId: member.id, amount: 2, type: "event" },
      ]),
    );
    const page = await execute(ctx, op("history"), userActor(member), { limit: 1 });
    writeTx(ctx, () => moveCredits(ctx, [{ userId: member.id, amount: 3, type: "event" }]));
    const next = await execute(ctx, op("history"), userActor(member), {
      limit: 1,
      cursor: page.nextCursor,
    });
    expect(next.items).toHaveLength(1);
    expect(next.items[0]).toMatchObject({
      id: movements[0]!.transactionId,
      actor: { id: 999, username: "User #999" },
    });
    expect(next.nextCursor).toBeNull();
    expect(next.balance).toBe(6);
    const end = await execute(ctx, op("history"), userActor(member), {
      cursor: encodeCursor([movements[0]!.transactionId]),
    });
    expect(end).toEqual({ balance: 6, items: [], nextCursor: null });
  });
});

describe("credit writes", () => {
  test("adjustments append immutable rows, allow negative balances, and publish movements", async () => {
    const ctx = setup();
    const staff = insertUser(ctx, { groupId: 4 });
    const member = insertUser(ctx);
    const actor = tokenActor(staff);
    const first = await execute(ctx, op("adjust"), actor, {
      userId: member.id,
      amount: 20,
      reason: "  Welcome  ",
    });
    const second = await execute(ctx, op("adjust"), actor, {
      userId: member.id,
      amount: -50,
      reason: "Correction",
    });
    expect(first).toMatchObject({
      userId: member.id,
      amount: 20,
      balanceAfter: 20,
      type: "adjustment",
      source: null,
      reason: "Welcome",
      actor: { id: staff.id, username: staff.username },
    });
    expect(second).toMatchObject({
      userId: member.id,
      amount: -50,
      balanceAfter: -30,
      reason: "Correction",
    });
    const history = await execute(ctx, op("history"), userActor(member), {});
    expect(history).toEqual({ items: [second, first], balance: -30, nextCursor: null });
    expect(
      ctx.sqlite
        .prepare(
          "SELECT target_id, payload FROM domain_events WHERE type = 'credits.changed' ORDER BY id",
        )
        .all(),
    ).toHaveLength(2);
  });

  test("adjust requires permission for self and other members; recalculation shares the permission", async () => {
    const ctx = setup();
    for (const groupId of [2, 3]) {
      const member = insertUser(ctx, { groupId });
      for (const userId of [member.id, 999])
        await expect(
          execute(ctx, op("adjust"), userActor(member), { userId, amount: 1, reason: "Test" }),
        ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(execute(ctx, op("recalculate"), userActor(member), {})).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    await expect(
      execute(ctx, op("adjust"), GUEST, { userId: 999, amount: 1, reason: "Test" }),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
    await expect(execute(ctx, op("recalculate"), GUEST, {})).rejects.toBeInstanceOf(
      UnauthenticatedError,
    );
    expect(ctx.sqlite.prepare("SELECT id FROM credit_transactions").all()).toEqual([]);
    expect(ctx.sqlite.prepare("SELECT id FROM jobs").all()).toEqual([]);
  });

  test("unknown adjustment targets and invalid amounts/reasons leave no movement", async () => {
    const ctx = setup();
    const admin = insertUser(ctx, { groupId: 4 });
    const actor = userActor(admin);
    await expect(
      execute(ctx, op("adjust"), actor, { userId: 999, amount: 10, reason: "Test" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    for (const amount of [0, 0.5, 1_000_000_001, -1_000_000_001])
      await expect(
        execute(ctx, op("adjust"), actor, { userId: admin.id, amount, reason: "Test" }),
      ).rejects.toBeInstanceOf(ValidationError);
    for (const reason of ["   ", "x".repeat(501)])
      await expect(
        execute(ctx, op("adjust"), actor, { userId: admin.id, amount: 1, reason }),
      ).rejects.toBeInstanceOf(ValidationError);
    expect(ctx.sqlite.prepare("SELECT id FROM credit_transactions").all()).toEqual([]);
    expect(ctx.sqlite.prepare("SELECT id FROM domain_events").all()).toEqual([]);
  });

  test("recalculate enqueues once with the scheduler's payload and unique key", async () => {
    const ctx = setup();
    const admin = userActor(insertUser(ctx, { groupId: 4 }));
    expect(await execute(ctx, op("recalculate"), admin, {})).toEqual({ queued: true });
    expect(await execute(ctx, op("recalculate"), admin, {})).toEqual({ queued: false });
    expect(ctx.sqlite.prepare("SELECT type, payload, unique_key, status FROM jobs").all()).toEqual([
      {
        type: "credits.recalculate",
        payload: '{"after":0}',
        unique_key: "credits.recalculate",
        status: "pending",
      },
    ]);
  });

  test("permission grants and denials control access independently of group rank", async () => {
    const ctx = setup();
    const member = insertUser(ctx);
    const admin = insertUser(ctx, { groupId: 4 });
    const entry = ctx.sqlite.prepare(
      "INSERT INTO permission_entries (permission_id, user_id, value) SELECT id, ?1, ?2 FROM permission_definitions WHERE key = ?3",
    );
    for (const permission of ["credits.adjust", "credits.viewAny"]) {
      entry.run(member.id, 1, permission);
      entry.run(admin.id, -1, permission);
    }
    const input = { userId: admin.id, amount: 4, reason: "Correction" };
    expect(await execute(ctx, op("adjust"), tokenActor(member), input)).toMatchObject({
      balanceAfter: 4,
      actor: { id: member.id, username: member.username },
    });
    expect(
      (await execute(ctx, op("ledger"), tokenActor(member), { userId: admin.id })).balance,
    ).toBe(4);
    expect(await execute(ctx, op("recalculate"), tokenActor(member), {})).toEqual({ queued: true });
    await expect(execute(ctx, op("adjust"), userActor(admin), input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(execute(ctx, op("ledger"), userActor(admin), {})).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(execute(ctx, op("recalculate"), userActor(admin), {})).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await execute(ctx, op("history"), userActor(admin), {})).balance).toBe(4);
  });

  test("ledger insertion failure rolls back the adjustment and its event", async () => {
    const ctx = setup();
    const admin = insertUser(ctx, { groupId: 4 });
    ctx.sqlite.exec(
      "CREATE TEMP TRIGGER reject_movement BEFORE INSERT ON credit_transactions BEGIN SELECT RAISE(ABORT, 'ledger unavailable'); END",
    );
    await expect(
      execute(ctx, op("adjust"), userActor(admin), {
        userId: admin.id,
        amount: 10,
        reason: "Test",
      }),
    ).rejects.toThrow("ledger unavailable");
    expect((await execute(ctx, op("history"), userActor(admin), {})).balance).toBe(0);
    expect(ctx.sqlite.prepare("SELECT id FROM domain_events").all()).toEqual([]);
  });

  test("out-of-range adjustments preserve the existing balance and ledger", async () => {
    const ctx = setup();
    const admin = insertUser(ctx, { groupId: 4 });
    writeTx(ctx, () =>
      moveCredits(ctx, [{ userId: admin.id, amount: Number.MAX_SAFE_INTEGER, type: "event" }]),
    );
    const before = await execute(ctx, op("history"), userActor(admin), {});
    await expect(
      execute(ctx, op("adjust"), userActor(admin), { userId: admin.id, amount: 1, reason: "Test" }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(await execute(ctx, op("history"), userActor(admin), {})).toEqual(before);
  });
});
