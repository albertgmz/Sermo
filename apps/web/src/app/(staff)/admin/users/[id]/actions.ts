"use server";

import {
  usersAdminErase,
  usersAdminGet,
  usersAdminUpdateIdentity,
  usersAdminUpdateProfile,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { formFailure, text } from "../../groups/form-errors";
import { memberOf, passwordRefusal, ticked } from "../action-helpers";

const PASSWORD_MODES = ["keep", "reset", "set"] as const;

// Saves the identity of a member: username, email, verified flag and password. Only what differs
// from what the form showed is sent. The administrator's password is checked first.
export async function saveIdentity(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const userId = memberOf(formData);
  if (userId === null) return { error: t("id") };
  const mode = text(formData, "passwordMode") || "keep";
  if (!(PASSWORD_MODES as readonly string[]).includes(mode)) {
    return { error: t("passwordMode") };
  }
  const refusal = await passwordRefusal(formData);
  if (refusal) return refusal;
  const username = text(formData, "username").trim();
  const email = text(formData, "email").trim();
  const verified = ticked(formData, "emailVerified");
  const password = text(formData, "password");
  if (mode === "set" && password === "") {
    return { fields: { password: t("newPassword") } };
  }
  const input: z.input<typeof usersAdminUpdateIdentity.input> = {
    userId,
    actorPassword: text(formData, "actorPassword"),
  };
  if (username !== "" && username !== text(formData, "usernameWas")) {
    input.username = username;
  }
  if (email !== "" && email !== text(formData, "emailWas")) input.email = email;
  if (verified !== (text(formData, "verifiedWas") === "1")) {
    input.emailVerified = verified;
  }
  if (mode === "reset") input.sendPasswordReset = true;
  if (mode === "set") input.password = password;
  if (Object.keys(input).length === 2) return { notice: t("unchanged") };
  try {
    await call(usersAdminUpdateIdentity, input);
  } catch (error) {
    return formFailure(error, ["username", "email", "password"]);
  }
  redirect(
    `/admin/users/${userId}?notice=${mode === "reset" ? "resetSent" : "identity"}`,
  );
}

// Removes the member's uploaded avatar or cover. It is the one picture operation the backend
// offers for another member.
export async function removePicture(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const userId = memberOf(formData);
  const which = text(formData, "which");
  if (userId === null || (which !== "avatar" && which !== "cover")) {
    return { error: t("id") };
  }
  try {
    await call(usersAdminUpdateProfile, {
      userId,
      ...(which === "avatar" ? { removeAvatar: true } : { removeCover: true }),
      reason: text(formData, "reason"),
    });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(`/admin/users/${userId}?notice=${which}Removed`);
}

// Erases the member's account for good. Needs a reason, the administrator's password and the
// member's username typed as it is now (read again here, never taken from the form).
export async function eraseMember(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminUsers.errors");
  const userId = memberOf(formData);
  if (userId === null) return { error: t("id") };
  const reason = text(formData, "reason").trim();
  if (reason === "") return { fields: { reason: t("reason") } };
  let username: string;
  try {
    username = (await call(usersAdminGet, { userId })).card.username;
  } catch (error) {
    return formFailure(error, []);
  }
  if (text(formData, "confirmUsername").trim() !== username) {
    return { fields: { confirmUsername: t("confirmUsername") } };
  }
  const refusal = await passwordRefusal(formData);
  if (refusal) return refusal;
  try {
    await call(usersAdminErase, {
      userId,
      actorPassword: text(formData, "actorPassword"),
      reason,
    });
  } catch (error) {
    return formFailure(error, ["reason"]);
  }
  redirect(`/admin/users/${userId}?notice=erased`);
}
