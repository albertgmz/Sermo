import * as z from "zod";
import { type Ctx, prepared } from "../../context";
import { Id } from "../../contracts/common";
import type { CreditTransactionType } from "../../db/schema";
import { NotFoundError } from "../../errors";
import { decodeCursor, encodeCursor } from "../../pagination";
import { loadUserSummaries } from "../../shared/users";
import { iso } from "../../time";

interface LedgerRow {
  id: number;
  user_id: number;
  amount: number;
  balance_after: number;
  type: CreditTransactionType;
  source_type: string | null;
  source_id: number | null;
  actor_id: number | null;
  reason: string;
  created_at: number;
}

const columns =
  "id, user_id, amount, balance_after, type, source_type, source_id, actor_id, reason, created_at";
export const ledgerSql = {
  member: `SELECT ${columns} FROM credit_transactions WHERE user_id = ?1 AND id <= ?2 ORDER BY id DESC LIMIT ?3`,
  all: `SELECT ${columns} FROM credit_transactions WHERE id <= ?1 ORDER BY id DESC LIMIT ?2`,
  balance: "SELECT credits FROM users WHERE id = ?1",
  transaction: `SELECT ${columns} FROM credit_transactions WHERE id = ?1`,
};
const cursorSchema = z.tuple([Id]);

export function memberBalance(ctx: Ctx, userId: number): number {
  const row = prepared(ctx, "credits.balance", () =>
    ctx.sqlite.prepare<{ credits: number }, [number]>(ledgerSql.balance),
  ).get(userId);
  if (!row) throw new NotFoundError();
  return row.credits;
}

function present(ctx: Ctx, rows: LedgerRow[]) {
  const users = loadUserSummaries(
    ctx,
    rows.flatMap((row) => (row.actor_id === null ? [] : [row.actor_id])),
  );
  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    amount: row.amount,
    balanceAfter: row.balance_after,
    type: row.type,
    source:
      row.source_type !== null && row.source_id !== null
        ? { type: row.source_type, id: row.source_id }
        : null,
    actor: row.actor_id === null ? null : users(row.actor_id),
    reason: row.reason,
    createdAt: iso(row.created_at),
  }));
}

export function ledgerPage(ctx: Ctx, input: { cursor?: string; limit: number }, userId?: number) {
  const through = input.cursor
    ? decodeCursor(input.cursor, cursorSchema)[0] - 1
    : Number.MAX_SAFE_INTEGER;
  const rows =
    userId === undefined
      ? prepared(ctx, "credits.ledger", () =>
          ctx.sqlite.prepare<LedgerRow, [number, number]>(ledgerSql.all),
        ).all(through, input.limit + 1)
      : prepared(ctx, "credits.memberLedger", () =>
          ctx.sqlite.prepare<LedgerRow, [number, number, number]>(ledgerSql.member),
        ).all(userId, through, input.limit + 1);
  const more = rows.length > input.limit;
  if (more) rows.pop();
  return {
    items: present(ctx, rows),
    nextCursor: more ? encodeCursor([rows.at(-1)!.id]) : null,
  };
}

export function ledgerTransaction(ctx: Ctx, id: number) {
  const row = prepared(ctx, "credits.transaction", () =>
    ctx.sqlite.prepare<LedgerRow, [number]>(ledgerSql.transaction),
  ).get(id);
  if (!row) throw new NotFoundError();
  return present(ctx, [row])[0]!;
}
