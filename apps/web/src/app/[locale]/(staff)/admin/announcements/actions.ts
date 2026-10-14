"use server";

import { announcementsCreate } from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import { formFailure, text } from "../groups/form-errors";

// Sends the alert to the audience the form chose. Nothing is sent unless the confirmation was
// ticked: the form keeps the send button behind it, but the action does not rely on that.
export async function sendAnnouncement(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminCommunication.errors");
  if (formData.get("confirm") === null) return { error: t("confirm") };
  const kind = text(formData, "audience");
  const groupId = parseId(text(formData, "groupId"));
  const usernames = text(formData, "usernames")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (kind === "group" && groupId === null)
    return { fields: { groupId: t("group") } };
  if (kind === "users" && usernames.length === 0)
    return { fields: { usernames: t("usernames") } };
  const url = text(formData, "url").trim();
  try {
    await call(announcementsCreate, {
      title: text(formData, "title"),
      body: text(formData, "body"),
      url: url === "" ? null : url,
      audience:
        kind === "group" && groupId !== null
          ? { kind, groupId }
          : kind === "users"
            ? { kind, usernames }
            : { kind: "all" },
    });
  } catch (error) {
    return formFailure(error, ["title", "body", "url", "groupId", "usernames"]);
  }
  redirect("/admin/announcements?notice=sent");
}
