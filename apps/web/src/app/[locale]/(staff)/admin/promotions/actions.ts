"use server";

import {
  promotionsCreate,
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
  ruleOf,
  text,
} from "../groups/form-errors";

const FIELDS = ["title", "isActive", "rule", "groupIds", "actorPassword"];

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
  const rule = ruleOf(formData);
  if (rule === null) return { fields: { rule: t("rule") } };
  const fields = {
    title: text(formData, "title"),
    isActive: formData.get("isActive") !== null,
    rule,
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
