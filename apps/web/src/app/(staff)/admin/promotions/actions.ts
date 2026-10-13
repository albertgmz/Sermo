"use server";

import {
  promotionsCreate,
  promotionsCriteria,
  promotionsDelete,
  promotionsRun,
  promotionsUpdate,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import {
  formFailure,
  missingPassword,
  text,
  whole,
} from "../groups/form-errors";

const FIELDS = ["title", "isActive", "criteria", "groupIds", "actorPassword"];

// The criteria the form offered, as the backend takes them. Only the criteria the backend lists
// are read, so a field invented by a client is ignored. Every value is a whole number (a yes/no
// criterion sends 1 or 0); the backend holds the range.
async function criteriaOf(formData: FormData) {
  const t = await getTranslations("adminGroups.errors");
  const { items } = await call(promotionsCriteria, {});
  const criteria: { criterion: string; value: number }[] = [];
  for (const definition of items) {
    if (formData.get(`use:${definition.id}`) === null) continue;
    const raw = text(formData, `value:${definition.id}`).trim();
    const value = whole(raw);
    if (value === null) {
      return { fail: { fields: { criteria: t("criterionValue") } } };
    }
    criteria.push({ criterion: definition.id, value });
  }
  return { criteria };
}

// The groups ticked.
function groupIdsOf(formData: FormData) {
  const ids = formData
    .getAll("groupIds")
    .map((value) => (typeof value === "string" ? parseId(value) : null));
  if (ids.some((id) => id === null)) return null;
  return [...new Set(ids as number[])];
}

export async function savePromotion(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminGroups.errors");
  const raw = text(formData, "id");
  const promotionId = raw === "" ? null : parseId(raw);
  if (raw !== "" && promotionId === null) return { error: t("id") };
  const groupIds = groupIdsOf(formData);
  if (groupIds === null) return { fields: { groupIds: t("groupIds") } };
  let parsed: Awaited<ReturnType<typeof criteriaOf>>;
  try {
    parsed = await criteriaOf(formData);
  } catch (error) {
    return formFailure(error, []);
  }
  if (parsed.fail) return parsed.fail;
  const fields = {
    title: text(formData, "title"),
    isActive: formData.get("isActive") !== null,
    criteria: parsed.criteria,
    groupIds,
  };
  // Who is in which group follows from the rules, so a change to them asks for the password,
  // which goes with the write and is checked first.
  const absent = await missingPassword(formData);
  if (absent) return absent;
  const actorPassword = text(formData, "actorPassword");
  let saved: number;
  try {
    saved = (
      promotionId === null
        ? await call(promotionsCreate, { ...fields, actorPassword })
        : await call(promotionsUpdate, {
            promotionId,
            ...fields,
            actorPassword,
          })
    ).id;
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  redirect(
    `/admin/promotions/${saved}?notice=${promotionId === null ? "created" : "saved"}`,
  );
}

export async function deletePromotion(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminGroups.errors");
  const promotionId = parseId(text(formData, "id"));
  if (promotionId === null) return { error: t("id") };
  const absent = await missingPassword(formData);
  if (absent) return absent;
  try {
    await call(promotionsDelete, {
      promotionId,
      actorPassword: text(formData, "actorPassword"),
    });
  } catch (error) {
    return formFailure(error, ["actorPassword"]);
  }
  redirect("/admin/promotions?notice=deleted");
}

export async function runPromotions(
  _previous: StaffFormState,
): Promise<StaffFormState> {
  const t = await getTranslations("adminGroups.promotions");
  try {
    const { queued } = await call(promotionsRun, {});
    return queued ? { notice: t("runQueued") } : { error: t("runNotQueued") };
  } catch (error) {
    return formFailure(error, []);
  }
}
