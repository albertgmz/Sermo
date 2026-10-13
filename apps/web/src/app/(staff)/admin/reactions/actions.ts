"use server";

import {
  reactionTypesCreate,
  reactionTypesList,
  reactionTypesUpdate,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import {
  formFailure,
  type OrderChange,
  saveInOrder,
  text,
  whole,
} from "../groups/form-errors";

const FIELDS = ["emoji", "title", "score", "position"];

// A number the form may leave empty: undefined then, so the backend applies its own.
function optionalWhole(raw: string): number | null | undefined {
  return raw.trim() === "" ? undefined : whole(raw);
}

export async function createReactionType(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminContent.errors");
  const score = optionalWhole(text(formData, "score"));
  const position = optionalWhole(text(formData, "position"));
  const fields: Record<string, string> = {};
  if (score === null) fields.score = t("number");
  if (position === null) fields.position = t("number");
  if (Object.keys(fields).length > 0) return { fields };
  try {
    await call(reactionTypesCreate, {
      emoji: text(formData, "emoji"),
      title: text(formData, "title"),
      score: score ?? undefined,
      position: position ?? undefined,
      isActive: formData.get("isActive") !== null,
    });
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  redirect("/admin/reactions?notice=created");
}

export async function updateReactionType(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminContent.errors");
  const reactionTypeId = parseId(text(formData, "id"));
  if (reactionTypeId === null) return { error: t("id") };
  const score = whole(text(formData, "score"));
  if (score === null) return { fields: { score: t("number") } };
  try {
    await call(reactionTypesUpdate, {
      reactionTypeId,
      emoji: text(formData, "emoji"),
      title: text(formData, "title"),
      score,
    });
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  redirect("/admin/reactions?notice=saved");
}

export async function setReactionTypeActive(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminContent.errors");
  const reactionTypeId = parseId(text(formData, "id"));
  const active = text(formData, "active");
  if (reactionTypeId === null || (active !== "1" && active !== "0")) {
    return { error: t("id") };
  }
  try {
    await call(reactionTypesUpdate, {
      reactionTypeId,
      isActive: active === "1",
    });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(
    `/admin/reactions?notice=${active === "1" ? "activated" : "deactivated"}`,
  );
}

// The positions typed in the order form, as `position.<id>`. Only the types whose position
// changed are updated.
export async function saveReactionOrder(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminContent.errors");
  const wanted = new Map<number, number>();
  const fields: Record<string, string> = {};
  const prefix = "position.";
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith(prefix) || typeof value !== "string") continue;
    const id = parseId(name.slice(prefix.length));
    if (id === null) return { error: t("id") };
    const position = whole(value);
    if (position === null) fields[name] = t("number");
    else wanted.set(id, position);
  }
  if (Object.keys(fields).length > 0) return { fields };
  const changes: OrderChange[] = [];
  try {
    const { items } = await call(reactionTypesList, {});
    for (const item of items) {
      const position = wanted.get(item.id);
      if (position === undefined || position === item.position) continue;
      changes.push({
        title: item.title,
        save: () =>
          call(reactionTypesUpdate, { reactionTypeId: item.id, position }),
      });
    }
  } catch (error) {
    return formFailure(error, []);
  }
  const { state } = await saveInOrder(changes);
  if (state) return state;
  redirect("/admin/reactions?notice=ordered");
}
