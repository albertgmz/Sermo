"use server";

import { usersDeleteOwnAccount } from "@sermo/core/contracts";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { FormState } from "@/app/[locale]/(auth)/actions";
import {
  formFailure,
  text,
} from "@/app/[locale]/(staff)/admin/groups/form-errors";
import { ACCOUNT_THEME_COOKIE } from "@/components/layout/theme";
import type { StaffFormState } from "@/components/staff/form-rows";
import { forgetAdoptedConsent } from "@/lib/consent/sync";
import {
  changePassword,
  getCurrentAccount,
  listSessions,
  requestEmailChange,
  revokeOtherSessions,
  revokeSession,
  sendVerificationEmail,
  signOut,
} from "@/lib/sermo/auth";
import { call } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";

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

// Deletes the member's own account. The username is typed out as it is now (read again here,
// never taken from the form) and the password goes with the write, which checks it first. The
// session is over by then, so the browser's cookies are cleared and the member lands on the home
// page with a notice. The confirmation step shows a refusal of the password on its own field,
// which it calls `actorPassword`.
export async function deleteAccount(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const { user } = await getViewer();
  if (!user) redirect("/login");
  if (text(formData, "confirmUsername").trim() !== user.username) {
    const t = await getTranslations("account.security.delete");
    return { error: t("confirmMismatch") };
  }
  try {
    await call(usersDeleteOwnAccount, {
      password: text(formData, "actorPassword"),
    });
  } catch (error) {
    const state = await formFailure(error, ["password"]);
    const password = state?.fields?.password;
    return password ? { ...state, fields: { actorPassword: password } } : state;
  }
  // The session is already gone, so the backend answers this sign-out with a 401; its answer
  // still clears the browser's cookies, which is all it is for. Its result is not checked.
  await signOut();
  await forgetAdoptedConsent();
  (await cookies()).delete(ACCOUNT_THEME_COOKIE);
  redirect("/?notice=accountDeleted");
}
