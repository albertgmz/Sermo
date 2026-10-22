import type { Ctx } from "../../context";
import * as contracts from "../../contracts/credits";
import { CREDIT_TRIGGERS } from "../../db/schema";
import { writeTx } from "../../db/tx";
import { NotFoundError, ValidationError } from "../../errors";
import { registerEventSubscriber } from "../../events";
import { implement } from "../../operation";
import { currentActor, requirePermission } from "../../permissions";
import { iso } from "../../time";
import { query, type RuleRow, type Trigger } from "./storage";
import { handleCreditRuleEvent } from "./subscriber";

function value(row: RuleRow) {
  return {
    id: row.id,
    title: row.title,
    trigger: row.trigger,
    amount: row.amount,
    isActive: !!row.is_active,
    limit:
      row.limit_count === null
        ? null
        : { count: row.limit_count, windowHours: row.limit_window_hours! },
    nodeIds: JSON.parse(row.node_ids) as number[],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function validateNodes(ctx: Ctx, trigger: Trigger, nodeIds: number[]): number[] {
  const ids = [...new Set(nodeIds)];
  if (!ids.length) return ids;
  if (!contracts.FORUM_CREDIT_TRIGGERS.includes(trigger))
    throw new ValidationError("Only forum triggers accept nodeIds.");
  const nodes = query<{ id: number; type: string }>(ctx, "forums").all(JSON.stringify(ids));
  if (nodes.length !== ids.length || nodes.some((node) => node.type !== "forum"))
    throw new ValidationError("nodeIds must be existing forums.");
  return ids;
}

function rule(ctx: Ctx, id: number): RuleRow {
  const row = query<RuleRow>(ctx, "rule").get(id);
  if (!row) throw new NotFoundError();
  return row;
}

export const creditRulesListOp = implement(contracts.creditRulesList, (ctx, actor) => {
  requirePermission(ctx, actor, "admin.creditRules");
  return {
    items: query<RuleRow>(ctx, "list").all().map(value),
    triggers: CREDIT_TRIGGERS.map((id) => ({
      id,
      acceptsForums: contracts.FORUM_CREDIT_TRIGGERS.includes(id),
    })),
  };
});
export const creditRulesCreateOp = implement(contracts.creditRulesCreate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.creditRules");
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.creditRules");
    const nodeIds = validateNodes(ctx, input.trigger, input.nodeIds);
    return value(
      query<RuleRow>(ctx, "create").get(
        input.title,
        input.trigger,
        input.amount,
        Number(input.isActive),
        input.limit?.count ?? null,
        input.limit?.windowHours ?? null,
        JSON.stringify(nodeIds),
        ctx.now(),
      )!,
    );
  });
});
export const creditRulesUpdateOp = implement(contracts.creditRulesUpdate, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.creditRules");
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.creditRules");
    const row = rule(ctx, input.ruleId);
    const current = value(row);
    const limit = input.limit === undefined ? current.limit : input.limit;
    const nodeIds = validateNodes(ctx, row.trigger, input.nodeIds ?? current.nodeIds);
    return value(
      query<RuleRow>(ctx, "update").get(
        input.title ?? row.title,
        input.amount ?? row.amount,
        Number(input.isActive ?? current.isActive),
        limit?.count ?? null,
        limit?.windowHours ?? null,
        JSON.stringify(nodeIds),
        ctx.now(),
        row.id,
      )!,
    );
  });
});
export const creditRulesDeleteOp = implement(contracts.creditRulesDelete, (ctx, actor, input) => {
  requirePermission(ctx, actor, "admin.creditRules");
  return writeTx(ctx, () => {
    requirePermission(ctx, currentActor(ctx, actor), "admin.creditRules");
    rule(ctx, input.ruleId);
    query(ctx, "delete").run(input.ruleId);
    return { ok: true };
  });
});

export const operations = [
  creditRulesListOp,
  creditRulesCreateOp,
  creditRulesUpdateOp,
  creditRulesDeleteOp,
];

export function registerCreditRuleJobs(ctx: Ctx): void {
  registerEventSubscriber(ctx, "credit-rules", (event) => handleCreditRuleEvent(ctx, event));
}
