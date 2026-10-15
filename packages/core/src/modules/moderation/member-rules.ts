import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import { phraseOr } from "../../i18n";
import { markPublic } from "../../operation";
import type { Rule } from "../../shared/criteria";
import { actorFacts, type Condition, criterionDefinitions, evaluate } from "../../shared/criteria";
import { readableTitle } from "../../shared/language";

const kinds = new Map(criterionDefinitions.map((definition) => [definition.id, definition.kind]));

/** A condition as a member reads it: "Post count: 5", "Email verified", "Days registered: 3 (in the last 30 days)". */
function describe(condition: Condition): string {
  const title = phraseOr(
    "en",
    `criterion.${condition.criterion}`,
    readableTitle(condition.criterion),
  );
  let text = title;
  if (condition.value !== undefined) {
    if (kinds.get(condition.criterion) !== "boolean") text = `${title}: ${condition.value}`;
    else if (condition.value === 0) text = `Not: ${title}`;
  }
  return condition.days === undefined ? text : `${text} (in the last ${condition.days} days)`;
}

/**
 * How the member falls short of a rule, or null when they hold it (an empty rule is held by
 * everyone, without a lookup). Only cheap criteria belong in such a rule: the facts are the
 * member's own row. `needs` is a sentence naming what is missing.
 */
export const ruleShortfall = markPublic(
  "Decides nothing itself: callers refuse or hold the write.",
  function ruleShortfall(ctx: Ctx, actor: Actor, rule: Rule): { needs: string } | null {
    if (rule.conditions.length === 0) return null;
    const facts = actorFacts(ctx, actor, [rule]);
    if (evaluate(rule, facts)) return null;
    if (rule.match === "any")
      return { needs: `one of: ${rule.conditions.map(describe).join("; ")}` };
    const missing = rule.conditions.filter(
      (condition) => !evaluate({ match: "all", conditions: [condition] }, facts),
    );
    return { needs: missing.map(describe).join("; ") };
  },
);
