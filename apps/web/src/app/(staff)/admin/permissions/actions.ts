"use server";

import {
  permissionsDefinitions,
  permissionsList,
  permissionsSet,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { matrixChanges } from "@/components/staff/permission-entries";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, missingPassword, text } from "../groups/form-errors";
import { permissionTitle } from "../groups/phrases";
import { entriesOf } from "./data";

// Saves the permission matrix of one target: a group (`group`), a member (`user`) or either on
// one forum (with `node`). The form carries the target's id, never a path to go back to.
//
// The acting administrator's own password goes with the write (`actorPassword`): the backend
// checks it first, in the same call, and a wrong one changes nothing.
export async function savePermissions(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminGroups.errors");
  const group = parseId(text(formData, "group"));
  const user = parseId(text(formData, "user"));
  const nodeRaw = text(formData, "node");
  const node = nodeRaw === "" ? null : parseId(nodeRaw);
  if (
    (group === null) === (user === null) ||
    (nodeRaw !== "" && node === null)
  ) {
    return { error: t("target") };
  }
  const absent = await missingPassword(formData);
  if (absent) return absent;
  const target =
    group !== null ? { groupId: group } : { userId: user as number };
  try {
    const [{ items }, current] = await Promise.all([
      call(permissionsDefinitions, {}),
      call(permissionsList, { ...target, nodeId: node }),
    ]);
    const shown =
      node === null ? items : items.filter((entry) => entry.scope === "node");
    const result = matrixChanges(
      formData,
      shown,
      entriesOf(current),
      node !== null,
    );
    if ("invalid" in result) {
      const definition = items.find((entry) => entry.id === result.invalid);
      return {
        error: t("value", {
          title: definition
            ? permissionTitle(definition.label)
            : result.invalid,
        }),
      };
    }
    if (result.changes.length === 0) {
      return {
        notice: (await getTranslations("adminGroups.matrix"))("unchanged"),
      };
    }
    await call(permissionsSet, {
      ...target,
      nodeId: node,
      entries: result.changes,
      actorPassword: text(formData, "actorPassword"),
    });
  } catch (error) {
    return formFailure(error, ["actorPassword"]);
  }
  const path =
    node !== null
      ? "/admin/permissions/forums"
      : group !== null
        ? `/admin/permissions/groups/${group}`
        : `/admin/permissions/members/${user}`;
  const query = new URLSearchParams();
  if (node !== null) {
    query.set("node", String(node));
    query.set(group !== null ? "group" : "user", String(group ?? user));
  }
  query.set("notice", "saved");
  redirect(`${path}?${query}`);
}
