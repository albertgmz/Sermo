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
// `node`, which also turns "No" on).
export async function PermissionForm({
  target,
  node,
  permissions,
  entries,
  heading,
}: {
  target: { group: number } | { user: number };
  node?: number;
  permissions: MatrixPermission[];
  entries: Record<string, MatrixValue>;
  heading: string;
}) {
  const t = await getTranslations("adminGroups.matrix");
  return (
    <FormRows action={savePermissions} heading={heading} submit={t("save")}>
      <input
        type="hidden"
        name={"group" in target ? "group" : "user"}
        value={"group" in target ? target.group : target.user}
      />
      {node !== undefined && <input type="hidden" name="node" value={node} />}
      <PermissionMatrix
        permissions={permissions}
        entries={entries}
        allowNo={node !== undefined}
      />
      <ConfirmPassword />
    </FormRows>
  );
}
