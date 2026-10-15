"use server";

import {
  normalizeTag,
  tagsDelete,
  tagsList,
  tagsMerge,
  tagsRename,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, text } from "../groups/form-errors";

// Renames a tag; the old name stays as an alias that reaches it.
export async function renameTag(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminContent.errors");
  const tagId = parseId(text(formData, "id"));
  if (tagId === null) return { error: t("id") };
  try {
    await call(tagsRename, { tagId, name: text(formData, "name") });
  } catch (error) {
    return formFailure(error, ["name"]);
  }
  redirect("/admin/tags?notice=renamed");
}

// Merges a tag into the one the field names: the backend takes ids, so the name is looked up first
// (a tag's own name sorts before any other that starts with it, so it is the first of its prefix).
export async function mergeTag(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminContent.errors");
  const tagId = parseId(text(formData, "id"));
  if (tagId === null) return { error: t("id") };
  // The name is read as the backend reads one (the same function), so `ας` is the tag `ασ`.
  const into = normalizeTag(text(formData, "into").trim());
  if (into === null) return { fields: { into: t("tag") } };
  try {
    const [found] = (await call(tagsList, { query: into, limit: 1 })).items;
    if (!found || found.name !== into) return { fields: { into: t("tag") } };
    await call(tagsMerge, { tagId, intoTagId: found.id });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect("/admin/tags?notice=merged");
}

export async function deleteTag(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminContent.errors");
  const tagId = parseId(text(formData, "id"));
  if (tagId === null) return { error: t("id") };
  try {
    await call(tagsDelete, { tagId });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect("/admin/tags?notice=deleted");
}
