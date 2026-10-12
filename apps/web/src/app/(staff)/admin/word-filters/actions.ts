"use server";

import { wordFiltersRemove, wordFiltersUpsert } from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, text } from "../groups/form-errors";

const ACTIONS = ["replace", "moderate"] as const;
const FIELDS = ["term", "action", "replacement"];

// Creates the filter for a term, or changes the one it already has: the backend keys filters by
// term, so a term cannot be renamed here.
export async function saveWordFilter(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminContent.errors");
  const action = ACTIONS.find((name) => name === text(formData, "action"));
  if (!action) return { fields: { action: t("choice") } };
  const replacement = text(formData, "replacement");
  const creating = formData.get("creating") !== null;
  try {
    await call(wordFiltersUpsert, {
      term: text(formData, "term"),
      action,
      replacement: replacement === "" ? null : replacement,
      isActive: formData.get("isActive") !== null,
    });
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  redirect(`/admin/word-filters?notice=${creating ? "created" : "saved"}`);
}

export async function removeWordFilter(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminContent.errors");
  const filterId = parseId(text(formData, "id"));
  if (filterId === null) return { error: t("id") };
  try {
    await call(wordFiltersRemove, { filterId });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect("/admin/word-filters?notice=removed");
}
