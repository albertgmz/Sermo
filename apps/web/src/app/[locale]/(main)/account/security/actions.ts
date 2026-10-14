"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { FormState } from "@/app/[locale]/(auth)/actions";
import {
  changePassword,
  getCurrentAccount,
  listSessions,
  requestEmailChange,
  revokeOtherSessions,
  revokeSession,
  sendVerificationEmail,
} from "@/lib/sermo/auth";

const SECURITY = "/account/security";

export type { FormState };

// Better Auth's error code to the key under account.security.errors.
const ERRORS: Record<string, string> = {
  INVALID_PASSWORD: "wrongCurrent",
  PASSWORD_TOO_SHORT: "tooShort",
  PASSWORD_TOO_LONG: "tooLong",
  VALIDATION_ERROR: "invalidEmail",
  CHANGE_EMAIL_DISABLED: "mailOff",
  VERIFICATION_EMAIL_NOT_ENABLED: "mailOff",
  RATE_LIMITED: "rateLimited",
};

async function failure(code: string | undefined): Promise<FormState> {
  if (code === "UNAUTHORIZED") redirect("/login");
  const t = await getTranslations("account.security.errors");
  return { error: t(((code && ERRORS[code]) || "generic") as "generic") };
}

// The form carries the id of the session, never its token: the token is looked up again here.
export async function revokeDevice(formData: FormData) {
  const [listing, account] = await Promise.all([
    listSessions(),
    getCurrentAccount(),
  ]);
  if (!account) redirect("/login");
  const target = listing.sessions.find(
    (session) => session.id === formData.get("session"),
  );
  // Already gone, or this very session, which is ended by logging out.
  if (!target || target.id === account.sessionId) {
    redirect(`${SECURITY}#sessions`);
  }
  const result = await revokeSession(target.token);
  redirect(
    `${SECURITY}?notice=${result.ok ? "revoked" : "revokeFailed"}#sessions`,
  );
}

export async function revokeOtherDevices() {
  const result = await revokeOtherSessions();
  if (result.code === "UNAUTHORIZED") redirect("/login");
  redirect(
    `${SECURITY}?notice=${result.ok ? "others" : "revokeFailed"}#sessions`,
  );
}

export async function updatePassword(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("account.security.errors");
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");
  if (!currentPassword || !newPassword) return { error: t("required") };
  if (newPassword !== confirm) return { error: t("mismatch") };
  if (newPassword === currentPassword) return { error: t("sameAsCurrent") };
  const result = await changePassword({
    currentPassword,
    newPassword,
    revokeOtherSessions: formData.get("revokeOthers") !== null,
  });
  if (!result.ok) return failure(result.code);
  redirect(`${SECURITY}?notice=password#password`);
}

export async function updateEmail(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("account.security.errors");
  const newEmail = String(formData.get("newEmail") ?? "").trim();
  if (!newEmail) return { error: t("invalidEmail") };
  const account = await getCurrentAccount();
  if (!account) redirect("/login");
  if (newEmail.toLowerCase() === account.email.toLowerCase()) {
    return { error: t("sameEmail") };
  }
  const result = await requestEmailChange(newEmail);
  if (!result.ok) return failure(result.code);
  redirect(`${SECURITY}?notice=emailChange#email`);
}

export async function resendOwnVerification() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login");
  if (account.emailVerified) redirect(`${SECURITY}#email`);
  const result = await sendVerificationEmail(account.email);
  const notice = result.ok
    ? "verification"
    : result.code === "RATE_LIMITED"
      ? "rateLimited"
      : "resendFailed";
  redirect(`${SECURITY}?notice=${notice}#email`);
}
