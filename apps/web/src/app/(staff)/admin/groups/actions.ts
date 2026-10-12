"use server";

import {
  groupsCreate,
  groupsDelete,
  groupsUpdate,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, missingPassword, text, whole } from "./form-errors";

const FIELDS = [
  "actorPassword",
  "title",
  "description",
  "rank",
  "userTitle",
  "badge",
  "nameColorId",
  "isStaff",
];

// The fields of the group form, as the backend takes them. The colour is a palette id or "" for
// none; the rank is a whole number (the backend holds its range).
async function groupFields(formData: FormData, creating: boolean) {
  const t = await getTranslations("adminGroups.errors");
  const typed = text(formData, "rank").trim();
  // A new group may leave the rank empty: the backend then applies its own.
  const rank = creating && typed === "" ? undefined : whole(typed);
  if (rank === null)
    return { fail: { fields: { rank: t("rank") } as Record<string, string> } };
  const colour = text(formData, "nameColorId");
  const nameColorId = colour === "" ? null : parseId(colour);
  if (colour !== "" && nameColorId === null) {
    return {
      fail: { fields: { nameColorId: t("colour") } as Record<string, string> },
    };
  }
  return {
    fields: {
      title: text(formData, "title"),
      description: text(formData, "description"),
      rank,
      userTitle: text(formData, "userTitle"),
      badge: text(formData, "badge"),
      nameColorId,
      isStaff: formData.get("isStaff") !== null,
    },
  };
}

export async function saveGroup(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminGroups.errors");
  const raw = text(formData, "id");
  const groupId = raw === "" ? null : parseId(raw);
  if (raw !== "" && groupId === null) return { error: t("id") };
  const parsed = await groupFields(formData, groupId === null);
  if (parsed.fail) return parsed.fail;
  const absent = await missingPassword(formData);
  if (absent) return absent;
  const actorPassword = text(formData, "actorPassword");
  let saved: number;
  try {
    saved = (
      groupId === null
        ? await call(groupsCreate, { ...parsed.fields, actorPassword })
        : await call(groupsUpdate, { groupId, ...parsed.fields, actorPassword })
    ).id;
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  redirect(
    `/admin/groups/${saved}?notice=${groupId === null ? "created" : "saved"}`,
  );
}

export async function deleteGroup(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminGroups.errors");
  const groupId = parseId(text(formData, "id"));
  if (groupId === null) return { error: t("id") };
  const absent = await missingPassword(formData);
  if (absent) return absent;
  try {
    await call(groupsDelete, {
      groupId,
      actorPassword: text(formData, "actorPassword"),
    });
  } catch (error) {
    return formFailure(error, ["actorPassword"]);
  }
  redirect("/admin/groups?notice=deleted");
}
