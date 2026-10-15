import "server-only";

import { CriteriaRule } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type { Rule } from "@/components/staff/criteria-rule";
import type { StaffFormState } from "@/components/staff/form-rows";
import { errorMessage } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";

// For actions: the state of a form whose password field is empty, or null. The password is sent
// with the write itself, which checks it first.
export async function missingPassword(
  formData: FormData,
): Promise<StaffFormState> {
  if (text(formData, "actorPassword") !== "") return null;
  const t = await getTranslations("adminGroups.errors");
  return { fields: { actorPassword: t("password") } };
}

// A change of an order form: what it is called in a message and the call that saves it.
export type OrderChange = { title: string; save: () => Promise<unknown> };

// What the message of a refused order change says: which message and the numbers and names in it.
export function orderRefusal(
  saved: number,
  total: number,
  title: string,
  message: string,
) {
  return {
    key: saved === 0 ? ("none" as const) : ("partial" as const),
    values: { saved, total, title, message },
  };
}

// For the order forms, which save each changed row with a call of its own: the changes go one by
// one and stop at the first refusal. The state says how many were saved and which row was refused,
// with the backend's message; it is null when every change went through. `saved` counts the
// changes that were stored, for the caller to renew what they affect.
export async function saveInOrder(
  changes: readonly OrderChange[],
): Promise<{ saved: number; state: StaffFormState }> {
  let saved = 0;
  for (const change of changes) {
    try {
      await change.save();
      saved++;
    } catch (error) {
      const t = await getTranslations("admin.ordering");
      const { key, values } = orderRefusal(
        saved,
        changes.length,
        change.title,
        await errorMessage(error),
      );
      return { saved, state: { error: t(key, values) } };
    }
  }
  return { saved, state: null };
}

// For actions: a refused call as the state of a form. A refusal that names a field of the form in
// its issues is shown under that field; anything else is the backend's message at the top. A
// validation refusal says what is wrong in each issue; any other refusal that names a field (a
// wrong password, too many wrong passwords) says it in its own message, the issue only points.
export async function formFailure(
  error: unknown,
  known: readonly string[],
): Promise<StaffFormState> {
  if (error instanceof SermoError && error.issues?.length) {
    const validation = error.code === "validation";
    const fields: Record<string, string> = {};
    const rest: string[] = [];
    for (const issue of error.issues) {
      const name = Array.isArray(issue.path) ? String(issue.path[0]) : "";
      const message = validation
        ? issue.message || error.message
        : error.message;
      if (known.includes(name) && !(name in fields)) fields[name] = message;
      else if (validation) rest.push(message);
    }
    if (Object.keys(fields).length > 0) {
      return { error: rest.join(" ") || undefined, fields };
    }
  }
  return { error: await errorMessage(error) };
}

// The `value` of a form field as text, or "" when it is absent or a file.
export const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

// A whole number typed in a field, or null.
export const whole = (raw: string) =>
  /^-?\d{1,15}$/.test(raw.trim()) ? Number(raw.trim()) : null;

// The rule the rule builder sent (one JSON field, `rule`), read with the shared schema, or null when
// the field is absent or is not a rule. The backend decides what a valid rule is.
export function ruleOf(formData: FormData): Rule | null {
  try {
    const parsed = CriteriaRule.safeParse(JSON.parse(text(formData, "rule")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
