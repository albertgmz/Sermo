"use server";

import { announcementsCreate } from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { formFailure, text } from "../groups/form-errors";

// Sends the announcement to every member. Nothing is sent unless the confirmation was ticked: the
// form keeps the send button behind it, but the action does not rely on that.
export async function sendAnnouncement(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminCommunication.errors");
  if (formData.get("confirm") === null) return { error: t("confirm") };
  try {
    await call(announcementsCreate, {
      title: text(formData, "title"),
      body: text(formData, "body"),
    });
  } catch (error) {
    return formFailure(error, ["title", "body"]);
  }
  redirect("/admin/announcements?notice=sent");
}
