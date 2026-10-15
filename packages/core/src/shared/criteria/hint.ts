import { type Language, phrase } from "../../i18n";
import { criterionDefinitions } from "../criteria";
import { titleFor } from "../language";
import type { Condition, Rule } from "./types";

type Definition = (typeof criterionDefinitions)[number];

const definitionOf = new Map<string, Definition>(
  criterionDefinitions.map((definition) => [definition.id, definition]),
);

function joined(language: Language, key: "and" | "or", parts: readonly string[]): string {
  return parts.reduce((first, second) =>
    phrase(language, `reaction.lock.${key}`, { first, second }),
  );
}

/**
 * What one condition asks, in words, or null when it is too involved to phrase: a number the
 * member must reach (at least, at most, below), or a yes/no that must hold. A window
 * of days, a mode and any list of ids (groups included: their titles are not public) are not
 * phrased.
 */
function conditionPhrase(language: Language, condition: Condition): string | null {
  const definition = definitionOf.get(condition.criterion);
  if (!definition || condition.days !== undefined || condition.mode !== undefined) return null;
  const criterion = titleFor(language, definition.label, definition.id);
  const { value, ids } = condition;
  switch (definition.kind) {
    case "atLeast":
    case "atMost":
    case "below":
      return value === undefined || ids !== undefined
        ? null
        : phrase(language, `reaction.lock.${definition.kind}`, { criterion, value });
    case "boolean":
      return value === 1 && ids === undefined ? criterion : null;
    default:
      return null;
  }
}

/**
 * Why a member the rule excludes is locked out: the requirements of its conditions, in the
 * criteria's own labels ("Unlocks with: Post count: 500 or more"). A plain "Locked" when any
 * condition is too involved to phrase.
 */
export function lockHint(language: Language, rule: Rule): string {
  const parts: string[] = [];
  for (const condition of rule.conditions) {
    const part = conditionPhrase(language, condition);
    if (part === null) return phrase(language, "reaction.lock.generic");
    parts.push(part);
  }
  if (parts.length === 0) return phrase(language, "reaction.lock.generic");
  return phrase(language, "reaction.lock.hint", {
    requirements: joined(language, rule.match === "all" ? "and" : "or", parts),
  });
}
