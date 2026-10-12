"use server";

import { creditsAdjust } from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, text, whole } from "../groups/form-errors";

// Gives or takes credits by hand. The amount is signed; the confirmation step was the page's.
export async function adjustCredits(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.adjust.errors");
  const userId = parseId(text(formData, "userId"));
  if (userId === null) return { error: t("member") };
  const amount = whole(text(formData, "amount"));
  if (amount === null) return { fields: { amount: t("amount") } };
  try {
    await call(creditsAdjust, {
      userId,
      amount,
      reason: text(formData, "reason"),
    });
  } catch (error) {
    return formFailure(error, ["amount", "reason"]);
  }
  redirect(`/admin/credits?userId=${userId}&notice=adjusted`);
}
