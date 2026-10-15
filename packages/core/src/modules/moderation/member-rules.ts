import type { Actor } from "../../actor";
import type { Ctx } from "../../context";
import { markPublic } from "../../operation";
import { actorFacts, type Rule } from "../../shared/criteria";
import { unmetRequirements } from "../../shared/criteria/hint";

/**
 * How the member falls short of a rule, or null when they hold it (an empty rule is held by
 * everyone, without a lookup). Only cheap criteria belong in such a rule: the facts are the
 * member's own row. `needs` is a sentence naming what is missing.
 */
export const ruleShortfall = markPublic(
  "Decides nothing itself: callers refuse or hold the write.",
  function ruleShortfall(ctx: Ctx, actor: Actor, rule: Rule): { needs: string } | null {
    if (rule.conditions.length === 0) return null;
    const needs = unmetRequirements("en", rule, actorFacts(ctx, actor, [rule]));
    return needs === null ? null : { needs };
  },
);
