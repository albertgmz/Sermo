"use server";

import { awardsGrant, awardsRevoke } from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, text } from "../groups/form-errors";

const back = (userId: number, notice: string) =>
  `/admin/award-grants?userId=${userId}&notice=${notice}`;

// Grant an active award to the member the form is about, with an optional note.
export async function grantAward(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.grants.errors");
  const userId = parseId(text(formData, "userId"));
  if (userId === null) return { error: t("member") };
  const awardId = parseId(text(formData, "awardId"));
  if (awardId === null) return { fields: { awardId: t("award") } };
  try {
    await call(awardsGrant, {
      userId,
      awardId,
      reason: text(formData, "reason"),
    });
  } catch (error) {
    return formFailure(error, ["awardId", "reason"]);
  }
  redirect(back(userId, "granted"));
}

// Revoke one grant, with a reason. The member is only where the page returns to.
export async function revokeGrant(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.grants.errors");
  const userId = parseId(text(formData, "userId"));
  const memberAwardId = parseId(text(formData, "memberAwardId"));
  if (userId === null || memberAwardId === null) return { error: t("grant") };
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
