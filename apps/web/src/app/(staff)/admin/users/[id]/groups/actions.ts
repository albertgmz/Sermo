"use server";

import { promotionsApply, usersSetGroups } from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, text } from "../../../groups/form-errors";
import { memberOf, passwordRefusal } from "../../action-helpers";

const PROMOTION_ACTIONS = ["promote", "demote", "exempt", "reset"] as const;

// Saves the primary group and the hand-assigned secondary groups (the full list). The password
// is checked first with `auth.verifyPassword`, then the groups are set: the two calls are not
// atomic.
export async function saveGroups(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const userId = memberOf(formData);
  const primaryGroupId = parseId(text(formData, "primaryGroupId"));
  const secondaryGroupIds = formData
    .getAll("secondary")
    .map((value) => (typeof value === "string" ? parseId(value) : null));
  if (
    userId === null ||
    primaryGroupId === null ||
    secondaryGroupIds.some((id) => id === null)
  ) {
    return { error: t("groups") };
  }
  const refusal = await passwordRefusal(formData);
  if (refusal) return refusal;
  try {
    await call(usersSetGroups, {
      userId,
      primaryGroupId,
      secondaryGroupIds: secondaryGroupIds as number[],
    });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(`/admin/users/${userId}/groups?notice=saved`);
}

// Changes one promotion for the member by hand.
export async function applyPromotion(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const userId = memberOf(formData);
  const promotionId = parseId(text(formData, "promotionId"));
  const action = text(formData, "action");
  if (
    userId === null ||
    promotionId === null ||
    !(PROMOTION_ACTIONS as readonly string[]).includes(action)
  ) {
    return { error: t("promotion") };
  }
  try {
    await call(promotionsApply, {
      userId,
      promotionId,
      action: action as (typeof PROMOTION_ACTIONS)[number],
    });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(`/admin/users/${userId}/groups?notice=promotionApplied`);
}
