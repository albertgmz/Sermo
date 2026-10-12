"use server";

import {
  creditRulesCreate,
  creditRulesDelete,
  creditRulesUpdate,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, text, whole } from "../groups/form-errors";
import { isTrigger, takesForums } from "./triggers";

const FIELDS = ["title", "trigger", "amount", "isActive", "limit", "nodeIds"];
const PATH = "/admin/credit-rules";

// The limit: both numbers empty is no limit, both typed a limit; one alone is not a limit.
function limitOf(formData: FormData) {
  const count = text(formData, "limitCount").trim();
  const hours = text(formData, "limitHours").trim();
  if (count === "" && hours === "") return { limit: null };
  const typed = [whole(count), whole(hours)];
  if (typed[0] === null || typed[1] === null) return { bad: true as const };
  return { limit: { count: typed[0], windowHours: typed[1] } };
}

// A new rule (no id) or a change of one. The forums are read only for a trigger that takes them:
// the form shows no forum list for the others.
export async function saveRule(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.rules.errors");
  const raw = text(formData, "id");
  const ruleId = raw === "" ? null : parseId(raw);
  if (raw !== "" && ruleId === null) return { error: t("id") };
  const trigger = text(formData, "trigger");
  if (!isTrigger(trigger)) return { fields: { trigger: t("trigger") } };
  const amount = whole(text(formData, "amount"));
  if (amount === null) return { fields: { amount: t("amount") } };
  const limit = limitOf(formData);
  if ("bad" in limit) return { fields: { limit: t("limit") } };
  let nodeIds: number[] | undefined;
  if (takesForums(trigger)) {
    const ids = formData
      .getAll("nodeIds")
      .map((value) => (typeof value === "string" ? parseId(value) : null));
    if (ids.some((id) => id === null)) {
      return { fields: { nodeIds: t("node") } };
    }
    nodeIds = [...new Set(ids as number[])];
  }
  const fields = {
    title: text(formData, "title"),
    amount,
    isActive: formData.get("isActive") !== null,
    limit: limit.limit,
    ...(nodeIds && { nodeIds }),
  };
  try {
    if (ruleId === null) await call(creditRulesCreate, { trigger, ...fields });
    else await call(creditRulesUpdate, { ruleId, ...fields });
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  redirect(`${PATH}?notice=${ruleId === null ? "created" : "saved"}`);
}

export async function deleteRule(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.rules.errors");
  const ruleId = parseId(text(formData, "id"));
  if (ruleId === null) return { error: t("id") };
  try {
    await call(creditRulesDelete, { ruleId });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(`${PATH}?notice=deleted`);
}
