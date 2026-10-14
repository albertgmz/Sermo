"use server";

import { usersAdminUpdateProfile } from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, text } from "../../../groups/form-errors";
import { memberOf } from "../../action-helpers";

type Input = z.input<typeof usersAdminUpdateProfile.input>;

const KEYS = ["accentId", "nameColorId", "frameId", "coverPresetId"] as const;

// What a member wears. Each choice is "" (leave it), "none" (take it off) or a catalog id; only
// the keys with a choice are sent. The backend takes any active entry whether or not the member
// holds it.
export async function saveAppearance(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const userId = memberOf(formData);
  if (userId === null) return { error: t("id") };
  const input: Input = { userId, reason: text(formData, "reason") };
  let chosen = 0;
  for (const key of KEYS) {
    const value = text(formData, key);
    if (value === "") continue;
    const id = value === "none" ? null : parseId(value);
    if (value !== "none" && id === null) {
      return { fields: { [key]: t("choice") } };
    }
    input[key] = id;
    chosen += 1;
  }
  if (chosen === 0) return { notice: t("unchanged") };
  try {
    await call(usersAdminUpdateProfile, input);
  } catch (error) {
    return formFailure(error, [...KEYS, "reason"]);
  }
  redirect(`/admin/users/${userId}/appearance?notice=saved`);
}
