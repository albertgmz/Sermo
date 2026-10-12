import { requireAuthenticated } from "../../actor";
import { prepared } from "../../context";
import * as contracts from "../../contracts/credits";
import { writeTx } from "../../db/tx";
import { implement } from "../../operation";
import { currentActor, getNodeTree, requirePermission, viewableNodeIds } from "../../permissions";
import { moveCredits } from "../../shared/credits";
import { requireNotErased } from "../admin/erased";
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
    requireNotErased(ctx, input.userId);
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

const waysSql =
  "SELECT title, trigger, amount, limit_count, limit_window_hours, node_ids FROM credit_rules WHERE is_active = 1 ORDER BY id LIMIT 100";

export const creditsWaysOp = implement(
  contracts.creditsWays,
  (ctx, actor) => {
    const rows = prepared(ctx, "credits.ways", () =>
      ctx.sqlite.prepare<
        {
          title: string;
          trigger: (typeof contracts.CreditRule.shape.trigger.options)[number];
          amount: number;
          limit_count: number | null;
          limit_window_hours: number | null;
          node_ids: string;
        },
        []
      >(waysSql),
    ).all();
    const visible = new Set(viewableNodeIds(ctx, actor));
    const titles = new Map(getNodeTree(ctx).entries.map((node) => [node.id, node.title]));
    const items = [];
    for (const row of rows) {
      const restricted = JSON.parse(row.node_ids) as number[];
      const forums = restricted
        .filter((id) => visible.has(id) && titles.has(id))
        .map((id) => ({ id, title: titles.get(id)! }));
      if (restricted.length && !forums.length) continue;
      items.push({
        title: row.title,
        trigger: row.trigger,
        amount: row.amount,
        limit:
          row.limit_count === null
            ? null
            : { count: row.limit_count, windowHours: row.limit_window_hours! },
        forums,
      });
    }
    return { items };
  },
  { public: "The active credit rules are public information, shown as ways to earn credits." },
);

export const operations = [
  creditsWaysOp,
  creditsHistoryOp,
  creditsLedgerOp,
  creditsAdjustOp,
  creditsRecalculateOp,
];
