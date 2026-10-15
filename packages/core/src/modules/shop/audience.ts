import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import { actorFacts, evaluate, parseRule } from "../../shared/criteria";

/**
 * The rows (categories or items) whose rule holds for the actor, in order. A row with no
 * conditions is for everyone. The actor's facts are loaded once, for what the rules ask.
 */
export function allowedBy<T extends { rule: string }>(
  ctx: Ctx,
  actor: Actor,
  rows: readonly T[],
): T[] {
  if (rows.length === 0) return [];
  const rules = rows.map((row) => parseRule(row.rule));
  const facts = actorFacts(ctx, actor, rules);
  return rows.filter((_, index) => evaluate(rules[index]!, facts));
}
