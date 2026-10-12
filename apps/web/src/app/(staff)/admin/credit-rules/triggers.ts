import { creditRulesCreate } from "@sermo/core/contracts";

// The triggers of a credit rule, as the contract lists them.
export const TRIGGERS = creditRulesCreate.input.shape.trigger.options;
export type Trigger = (typeof TRIGGERS)[number];

// The triggers about forum content, the only ones a rule may be restricted to some forums for
// (the contract states it in prose above `CreditRule.nodeIds`, not as a list). It only decides
// whether the forum picker is shown; the backend refuses a restriction on any other trigger.
const FORUM_TRIGGERS: readonly Trigger[] = [
  "thread_created",
  "reply_posted",
  "reply_received",
  "reaction_given",
  "reaction_received",
];

export const takesForums = (trigger: string) =>
  (FORUM_TRIGGERS as readonly string[]).includes(trigger);

export const isTrigger = (value: string): value is Trigger =>
  (TRIGGERS as readonly string[]).includes(value);
