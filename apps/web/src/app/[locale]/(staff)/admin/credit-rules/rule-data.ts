import "server-only";

import { creditRulesList, nodesList } from "@sermo/core/contracts";
import { read } from "@/lib/sermo/client";

// What the list, the new and the edit page of the rules all need: the rules, the triggers the
// backend offers, and the forums a rule can be restricted to (a rule can be restricted to forums,
// not to categories). The backend does not page rules.
export async function ruleData() {
  const [{ items, triggers }, tree] = await Promise.all([
    read(creditRulesList, {}),
    read(nodesList, {}),
  ]);
  const nodes = tree.items
    .filter((node) => node.type === "forum")
    .map(({ id, title, depth }) => ({ id, title, depth }));
  return { items, triggers, nodes };
}
