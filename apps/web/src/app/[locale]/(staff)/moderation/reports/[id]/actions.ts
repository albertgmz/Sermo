"use server";

import { reportsSetState } from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, text } from "../../../admin/groups/form-errors";
import { noticeOf } from "../../notice-input";

// The states the contract lets a moderator set; a report cannot be put back to "open".
const STATES = reportsSetState.input.shape.state.options;

const FIELDS = ["state", "reason", "message"];

export async function setReportState(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("moderation.errors");
  const groupId = parseId(text(formData, "groupId"));
  if (groupId === null) return { error: t("id") };
  const state = STATES.find((option) => option === text(formData, "state"));
  if (!state) return { fields: { state: t("state") } };
  try {
    await call(reportsSetState, { groupId, state, ...noticeOf(formData) });
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  redirect(`/moderation/reports/${groupId}?notice=stateSaved`);
}
