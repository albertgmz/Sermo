"use server";

import {
  awardsGrant,
  awardsRevoke,
  creditsAdjust,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, text, whole } from "../../../groups/form-errors";
import { memberOf, ticked } from "../../action-helpers";

const back = (userId: number, notice: string) =>
  `/admin/users/${userId}/economy?notice=${notice}`;

// Gives or takes credits by hand. The confirmation box must be ticked; the amount is signed.
export async function adjustCredits(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const userId = memberOf(formData);
  if (userId === null) return { error: t("id") };
  const amount = whole(text(formData, "amount"));
  if (amount === null) return { fields: { amount: t("amount") } };
  if (!ticked(formData, "confirm"))
    return { fields: { confirm: t("confirm") } };
  try {
    await call(creditsAdjust, {
      userId,
      amount,
      reason: text(formData, "reason"),
    });
  } catch (error) {
    return formFailure(error, ["amount", "reason"]);
  }
  redirect(back(userId, "adjusted"));
}

export async function grantAward(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const userId = memberOf(formData);
  const awardId = parseId(text(formData, "awardId"));
  if (userId === null) return { error: t("id") };
  if (awardId === null) return { fields: { awardId: t("award") } };
  try {
    await call(awardsGrant, {
      userId,
      awardId,
      reason: text(formData, "reason"),
    });
  } catch (error) {
    return formFailure(error, ["reason"]);
  }
  redirect(back(userId, "granted"));
}

export async function revokeAward(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const userId = memberOf(formData);
  const memberAwardId = parseId(text(formData, "memberAwardId"));
  if (userId === null || memberAwardId === null) return { error: t("id") };
  try {
    await call(awardsRevoke, {
      memberAwardId,
      reason: text(formData, "reason"),
    });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(back(userId, "revoked"));
}
