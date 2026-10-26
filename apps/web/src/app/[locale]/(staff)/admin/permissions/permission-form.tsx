import { getTranslations } from "next-intl/server";
import { ConfirmPassword } from "@/components/staff/confirm-password";
import { FormRows } from "@/components/staff/form-rows";
import type { MatrixValue } from "@/components/staff/permission-entries";
import {
  type MatrixPermission,
  PermissionMatrix,
} from "@/components/staff/permission-matrix";
import { savePermissions } from "./actions";

// The permission matrix of one target as a form that saves with the acting administrator's
// password: a group (`target.group`), a member (`target.user`), or either on one forum (with
// `node`, which also turns "No" on). `focus` is the permission a search result led to.
export async function PermissionForm({
  target,
  node,
  permissions,
  entries,
  heading,
  focus,
}: {
  target: { group: number } | { user: number };
  node?: number;
  permissions: MatrixPermission[];
  entries: Record<string, MatrixValue>;
  heading: string;
  focus?: string;
}) {
  const t = await getTranslations("adminGroups.matrix");
  return (
    <FormRows
      // A new target, or entries changed by a save, start the form afresh (fields, password).
      key={`${node ?? 0}:${"group" in target ? `g${target.group}` : `u${target.user}`}:${JSON.stringify(entries)}`}
      action={savePermissions}
      heading={heading}
      submit={t("save")}
    >
      <input
        type="hidden"
        name={"group" in target ? "group" : "user"}
        value={"group" in target ? target.group : target.user}
      />
      {node !== undefined && <input type="hidden" name="node" value={node} />}
      <ConfirmPassword />
      <PermissionMatrix
        permissions={permissions}
        entries={entries}
        allowNo={node !== undefined}
        focus={focus}
      />
    </FormRows>
  );
}
