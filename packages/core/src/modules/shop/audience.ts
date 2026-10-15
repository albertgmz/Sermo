import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import { actorFacts, evaluate, type Facts, loadFacts, parseRule } from "../../shared/criteria";

const holds = (facts: Facts, rows: readonly { rule: string }[]) =>
  rows.map((row) => evaluate(parseRule(row.rule), facts));

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
  const facts = actorFacts(
    ctx,
    actor,
    rows.map((row) => parseRule(row.rule)),
  );
  const ok = holds(facts, rows);
  return rows.filter((_, index) => ok[index]);
}

/** Whether every row's rule holds for the member with this id (the recipient of a gift). */
export function allAllowFor(
  ctx: Ctx,
  memberId: number,
  rows: readonly { rule: string }[],
): boolean {
  const facts = loadFacts(
    ctx,
    [memberId],
    rows.map((row) => parseRule(row.rule)),
  ).get(memberId)!;
  return holds(facts, rows).every(Boolean);
}
