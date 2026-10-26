"use server";

import {
  creditRulesBackfillApply,
  creditRulesBackfillPreview,
  creditRulesCreate,
  creditRulesDelete,
  creditRulesList,
  creditRulesUpdate,
} from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, text, whole } from "../groups/form-errors";

const FIELDS = [
  "title",
  "trigger",
  "amount",
  "isActive",
  "limit",
  "nodeIds",
  "filters",
];
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

// The filters on the source content: empty fields are no filter. A date is the `YYYY-MM-DD` of a
// date field, a length a whole number; anything else is not a filter.
function filtersOf(formData: FormData) {
  const [createdFrom, createdUntil, minLength, maxLength] = [
    "createdFrom",
    "createdUntil",
    "minLength",
    "maxLength",
  ].map((name) => text(formData, name).trim());
  const lengths = [minLength, maxLength].map((raw) =>
    raw === "" ? null : whole(raw),
  );
  const badDate = [createdFrom, createdUntil].some(
    (raw) => raw !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(raw),
  );
  if (
    badDate ||
    [minLength, maxLength].some((raw, i) => raw !== "" && lengths[i] === null)
  )
    return { bad: true as const };
  return {
    filters: {
      createdFrom: createdFrom || null,
      createdUntil: createdUntil || null,
      minLength: lengths[0],
      maxLength: lengths[1],
    },
  };
}

// A new rule (no id) or a change of one. The forums are read only for a trigger that takes them
// (the backend says which): the form shows no forum list for the others.
export async function saveRule(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.rules.errors");
  const raw = text(formData, "id");
  const ruleId = raw === "" ? null : parseId(raw);
  if (raw !== "" && ruleId === null) return { error: t("id") };
  const named = creditRulesCreate.input.shape.trigger.safeParse(
    text(formData, "trigger"),
  );
  if (!named.success) return { fields: { trigger: t("trigger") } };
  const trigger = named.data;
  const amount = whole(text(formData, "amount"));
  if (amount === null) return { fields: { amount: t("amount") } };
  const limit = limitOf(formData);
  if ("bad" in limit) return { fields: { limit: t("limit") } };
  let takesForums: boolean;
  let takesFilters: boolean;
  try {
    const { triggers } = await call(creditRulesList, {});
    const entry = triggers.find((choice) => choice.id === trigger);
    takesForums = !!entry?.acceptsForums;
    takesFilters = !!entry?.acceptsFilters;
  } catch (error) {
    return formFailure(error, []);
  }
  let nodeIds: number[] | undefined;
  if (takesForums) {
    const ids = formData
      .getAll("nodeIds")
      .map((value) => (typeof value === "string" ? parseId(value) : null));
    if (ids.some((id) => id === null)) {
      return { fields: { nodeIds: t("node") } };
    }
    nodeIds = [...new Set(ids as number[])];
  }
  const filters = takesFilters ? filtersOf(formData) : {};
  if ("bad" in filters) return { fields: { filters: t("filters") } };
  const fields = {
    title: text(formData, "title"),
    amount,
    isActive: formData.get("isActive") !== null,
    limit: limit.limit,
    ...(nodeIds && { nodeIds }),
    ...filters,
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

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Start a preview of paying past activity: the two days of a date field and a whole cap. The
// backend checks the rest (the order of the days, the dates already paid, a run under way).
export async function previewPastActivity(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.rules.past");
  const from = text(formData, "from").trim();
  const until = text(formData, "until").trim();
  const cap = whole(text(formData, "cap"));
  const fields: Record<string, string> = {};
  if (!DAY.test(from)) fields.from = t("errors.day");
  if (!DAY.test(until)) fields.until = t("errors.day");
  if (cap === null || cap < 1) fields.cap = t("errors.cap");
  if (cap === null || Object.keys(fields).length > 0) return { fields };
  try {
    await call(creditRulesBackfillPreview, { from, until, cap });
  } catch (error) {
    return formFailure(error, ["from", "until", "cap"]);
  }
  revalidatePath("/[locale]/admin/credit-rules", "page");
  return { notice: t("previewQueued") };
}

// Pay the finished preview the confirmation names.
export async function payPastActivity(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.rules.past");
  const previewId = parseId(text(formData, "previewId"));
  if (previewId === null) return { error: t("errors.preview") };
  try {
    await call(creditRulesBackfillApply, { previewId });
  } catch (error) {
    return formFailure(error, []);
  }
  revalidatePath("/[locale]/admin/credit-rules", "page");
  return { notice: t("applyQueued") };
}
