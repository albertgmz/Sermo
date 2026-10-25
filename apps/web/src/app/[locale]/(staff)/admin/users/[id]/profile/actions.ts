"use server";

import { usersAdminUpdateProfile } from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { formFailure, text } from "../../../groups/form-errors";
import { memberOf, ticked } from "../../action-helpers";

type Input = z.input<typeof usersAdminUpdateProfile.input>;

const FIELDS = [
  "about",
  "location",
  "website",
  "customTitle",
  "signature",
  "isAdult",
  "reason",
];

// Saves the profile text of a member. Only the keys the form shows are sent: the three fields
// read from the public profile when that read worked (`known`), and only when the posted value
// differs from the one the form was built with (`was:<key>`), so a field the administrator did not
// touch is not written back over a change made meanwhile. The title and signature are sent only
// when something is typed or "remove" is ticked, because an administrator cannot read their
// stored source and an empty box must not overwrite them.
export async function saveProfile(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const userId = memberOf(formData);
  if (userId === null) return { error: t("id") };
  const input: Input = { userId, reason: text(formData, "reason") };
  const known = text(formData, "known") === "1";
  for (const key of ["about", "location", "website"] as const) {
    const value = text(formData, key);
    if (known ? value !== text(formData, `was:${key}`) : value !== "") {
      input[key] = value;
    }
  }
  for (const key of ["customTitle", "signature"] as const) {
    const value = text(formData, key);
    if (ticked(formData, `clear-${key}`)) input[key] = null;
    else if (value.trim() !== "") input[key] = value;
  }
  // The +18 switch, shown while the site's +18 mode is on: sent when changed, or when ticked if the
  // profile's mark could not be read.
  if (formData.has("adultShown")) {
    const isAdult = ticked(formData, "isAdult");
    const was = formData.get("was:isAdult");
    if (was === null ? isAdult : String(isAdult) !== was)
      input.isAdult = isAdult;
  }
  try {
    await call(usersAdminUpdateProfile, input);
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  redirect(`/admin/users/${userId}/profile?notice=saved`);
}
