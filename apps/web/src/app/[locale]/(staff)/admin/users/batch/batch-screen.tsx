import { BATCH_MEMBER_LIMIT } from "@sermo/core/contracts";
import { RuleField } from "@/components/staff/rule-field";
import { getViewer } from "@/lib/sermo/session";
import { getGroups } from "../../groups/data";
import { holds } from "../data";
import { BatchForm } from "./batch-form";
import { BATCH_ACTIONS } from "./state";

// The batch update of members: the groups to choose from, the changes the viewer's permissions
// offer (banning needs its own permission; the backend judges every member again), and the rule
// builder, which is drawn here because it reads the criteria from the backend.
export async function BatchScreen() {
  const [viewer, groups] = await Promise.all([getViewer(), getGroups()]);
  const mayBan = holds(viewer, "member.ban");
  return (
    <BatchForm
      // The guest group cannot be assigned.
      groups={groups
        .filter((group) => group.builtin !== "guest")
        .map(({ id, title }) => ({ id, title }))}
      actions={BATCH_ACTIONS.filter(
        (name) => mayBan || (name !== "ban" && name !== "liftBans"),
      )}
      limit={BATCH_MEMBER_LIMIT}
      criteria={<RuleField place="memberBatch" />}
    />
  );
}
