"use server";

import {
  awardsRun,
  creditsRecalculate,
  promotionsRun,
  spamCleanupStart,
} from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, text } from "../groups/form-errors";

// The operations that take no input and answer "queued". The permission each needs is the
// backend's to check.
const QUEUED = {
  credits: () => call(creditsRecalculate, {}),
  promotions: () => call(promotionsRun, {}),
  awards: () => call(awardsRun, {}),
};

export async function runOperation(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminTools.maintenance");
  const operation = (Object.keys(QUEUED) as (keyof typeof QUEUED)[]).find(
    (name) => name === text(formData, "operation"),
  );
  if (!operation) return { error: t("errors.operation") };
  try {
    const { queued } = await QUEUED[operation]();
    return queued
      ? { notice: t("result.queued") }
      : { error: t("result.notQueued") };
  } catch (error) {
    return formFailure(error, []);
  }
}

// Spam cleanup for one member: the member comes from the form (a hidden id set by the picker's
// choice), the reason is sent only when typed.
export async function runSpamCleanup(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminTools.maintenance");
  const userId = parseId(text(formData, "userId"));
  if (userId === null) return { error: t("errors.member") };
  const reason = text(formData, "reason").trim();
  try {
    const { jobId } = await call(spamCleanupStart, {
      userId,
      ...(reason && { reason }),
    });
    return { notice: t("result.spamQueued", { jobId }) };
  } catch (error) {
    return formFailure(error, []);
  }
}
