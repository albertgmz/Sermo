import { expect, test } from "bun:test";
import { createTestContext, expectNoTableScan, insertUser } from "@sermo/core/testing";
import { closeContext } from "../../context";
import { writeTx } from "../../db/tx";
import { moveCredits } from "../../shared/credits";
import { ledgerSql } from "./ledger";
import { CREDIT_RECALCULATE_CHUNK_SIZE, rebuildSql } from "./rebuild";

test("ledger reads and balance repairs seek their filter and sort indexes", () => {
  const ctx = createTestContext();
  try {
    const member = insertUser(ctx);
    const [row] = writeTx(ctx, () =>
      moveCredits(ctx, [{ userId: member.id, amount: 10, type: "event" }]),
    );
    for (const through of [Number.MAX_SAFE_INTEGER, row!.transactionId, 0]) {
      expectNoTableScan(ctx, ledgerSql.member, [member.id, through, 21]);
      expectNoTableScan(ctx, ledgerSql.all, [through, 21]);
    }
    expectNoTableScan(ctx, ledgerSql.balance, [member.id]);
    expectNoTableScan(ctx, ledgerSql.transaction, [row!.transactionId]);
    expectNoTableScan(ctx, rebuildSql.page, [0, CREDIT_RECALCULATE_CHUNK_SIZE]);
    expectNoTableScan(ctx, rebuildSql.page, [member.id, CREDIT_RECALCULATE_CHUNK_SIZE]);
    expectNoTableScan(ctx, rebuildSql.update, [10, member.id]);
    expect(ctx.sqlite.prepare(rebuildSql.page).all(0, CREDIT_RECALCULATE_CHUNK_SIZE)).toEqual([
      { id: member.id, credits: 10, balance: 10 },
    ]);
  } finally {
    closeContext(ctx);
  }
});
