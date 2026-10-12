import { requireAuthenticated } from "../../actor";
import * as contracts from "../../contracts/credits";
import { writeTx } from "../../db/tx";
import { implement } from "../../operation";
import { currentActor, requirePermission } from "../../permissions";
import { moveCredits } from "../../shared/credits";
import { enqueueJob } from "../jobs/queue";
import { ledgerPage, ledgerTransaction, memberBalance } from "./ledger";

export { registerCreditJobs } from "./rebuild";

export const creditsHistoryOp = implement(
  contracts.creditsHistory,
  (ctx, actor, input) => {
    const member = requireAuthenticated(actor);
    const balance = memberBalance(ctx, member.userId);
    return { ...ledgerPage(ctx, input, member.userId), balance };
  },
  { public: "Every signed-in member may read their own credit balance and ledger." },
);

export const creditsLedgerOp = implement(contracts.creditsLedger, (ctx, actor, input) => {
  requirePermission(ctx, actor, "credits.viewAny");
  const balance = input.userId === undefined ? null : memberBalance(ctx, input.userId);
  return { ...ledgerPage(ctx, input, input.userId), balance };
});

export const creditsAdjustOp = implement(contracts.creditsAdjust, (ctx, actor, input) => {
  requirePermission(ctx, actor, "credits.adjust");
  const member = requireAuthenticated(actor);
  return writeTx(ctx, () => {
    // The actor was resolved before this transaction: decide with what is committed now.
    requirePermission(ctx, currentActor(ctx, actor), "credits.adjust");
    const [movement] = moveCredits(ctx, [{ ...input, type: "adjustment", actorId: member.userId }]);
    return ledgerTransaction(ctx, movement!.transactionId);
  });
});

export const creditsRecalculateOp = implement(contracts.creditsRecalculate, (ctx, actor) => {
  requirePermission(ctx, actor, "credits.adjust");
  return {
    queued:
      enqueueJob(ctx, "credits.recalculate", { after: 0 }, { uniqueKey: "credits.recalculate" }) !==
      null,
  };
});

export const operations = [
  creditsHistoryOp,
  creditsLedgerOp,
  creditsAdjustOp,
  creditsRecalculateOp,
];
