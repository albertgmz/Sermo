import { RuleField } from "@/components/staff/rule-field";
import { getGroups } from "../groups/data";
import { BroadcastForm } from "./broadcast-form";
import { BroadcastStatus } from "./broadcast-status";
import type { BroadcastKind } from "./state";

// A message or an alert to members: the form, then the latest run. The groups to tick come from
// the backend, and the rule builder is drawn here because it reads the criteria from it.
export async function BroadcastScreen({ kind }: { kind: BroadcastKind }) {
  const groups = await getGroups();
  return (
    <div className="space-y-4">
      <BroadcastForm
        kind={kind}
        // The guest group cannot be written to.
        groups={groups
          .filter((group) => group.builtin !== "guest")
          .map(({ id, title }) => ({ id, title }))}
        rule={<RuleField place="broadcast" />}
      />
      <BroadcastStatus kind={kind} />
    </div>
  );
}
