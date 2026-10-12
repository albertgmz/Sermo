import type { Ctx } from "../context";
import { prepared } from "../context";
import type { CreditTransactionType } from "../db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { publishEvent } from "../events";

/** One change to one member's balance. */
export interface CreditMovement {
  userId: number;
  /** Signed and never 0: positive pays the member, negative charges them. */
  amount: number;
  type: CreditTransactionType;
  /** What caused it, e.g. { type: "shop_purchase", id: 12 }. */
  source?: { type: string; id: number };
  /** Who did it; omit for the system. */
  actorId?: number | null;
  reason?: string;
  /**
   * Refuse a charge the balance cannot cover (purchases, stakes). Without it the balance may go
   * below zero, which penalties and reversals need: spending first must not dodge them.
   */
  requireFunds?: boolean;
}

export interface CreditResult {
  transactionId: number;
  userId: number;
  balance: number;
}

/**
 * The only writer of `users.credits` and `credit_transactions`. Applies every movement in the
 * caller's write transaction: each one updates the balance, appends its ledger row with the
 * resulting balance and publishes `credits.changed`, so the balance always equals the sum of the
 * member's ledger. Several members may be moved in one call (a gift, a pot, a wager): either all
 * movements apply or the transaction rolls back.
 *
 * A movement with `requireFunds` is a conditional UPDATE, so two concurrent charges can never
 * both spend the same credits; when the balance is short it throws ConflictError. An unknown
 * member throws NotFoundError.
 */
export function moveCredits(ctx: Ctx, movements: readonly CreditMovement[]): CreditResult[] {
  if (!ctx.sqlite.inTransaction) throw new Error("moveCredits requires a write transaction");
  const update = prepared(ctx, "shared.creditsUpdate", () =>
    ctx.sqlite.prepare<{ credits: number }, [number, number, number]>(
      "UPDATE users SET credits = credits + ?1 WHERE id = ?2 AND (?3 = 0 OR ?1 >= 0 OR credits + ?1 >= 0) RETURNING credits",
    ),
  );
  const exists = prepared(ctx, "shared.creditsMember", () =>
    ctx.sqlite.prepare<{ id: number }, [number]>("SELECT id FROM users WHERE id = ?1"),
  );
  const insert = prepared(ctx, "shared.creditsInsert", () =>
    ctx.sqlite.prepare<
      { id: number },
      [number, number, number, string, string | null, number | null, number | null, string, number]
    >(
      "INSERT INTO credit_transactions (user_id, amount, balance_after, type, source_type, source_id, actor_id, reason, created_at) " +
        "VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id",
    ),
  );
  const now = ctx.now();
  return movements.map((movement) => {
    if (!Number.isSafeInteger(movement.amount) || movement.amount === 0)
      throw new Error("A credit movement needs a non-zero integer amount.");
    const row = update.get(movement.amount, movement.userId, movement.requireFunds ? 1 : 0);
    if (!row) {
      if (!exists.get(movement.userId)) throw new NotFoundError();
      throw new ConflictError("Not enough credits.");
    }
    const actorId = movement.actorId ?? null;
    const transactionId = insert.get(
      movement.userId,
      movement.amount,
      row.credits,
      movement.type,
      movement.source?.type ?? null,
      movement.source?.id ?? null,
      actorId,
      movement.reason ?? "",
      now,
    )!.id;
    publishEvent(ctx, {
      type: "credits.changed",
      targetType: "user",
      targetId: movement.userId,
      payload: {
        transactionId,
        amount: movement.amount,
        balance: row.credits,
        type: movement.type,
        sourceType: movement.source?.type ?? null,
        sourceId: movement.source?.id ?? null,
        actorId,
      },
    });
    return { transactionId, userId: movement.userId, balance: row.credits };
  });
}
