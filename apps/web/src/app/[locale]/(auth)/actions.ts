"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  CONSENT_COOKIE,
  POLICY_VERSION,
  REFERRAL_COOKIE,
} from "@/lib/consent/inventory";
import { mayStoreReferral, parseConsent } from "@/lib/consent/state";
import { referrerOf } from "@/lib/referral/link";
import {
  requestPasswordReset,
  resetPassword,
  sendVerificationEmail,
  signInWithEmail,
  signInWithUsername,
  signUp,
} from "@/lib/sermo/auth";
import { safeReturnPath } from "@/lib/sermo/return-path";

export type AuthState = { error: string; username: string };

// Better Auth's error code to the key under auth.actions.errors.
const ERRORS: Record<string, string> = {
  INVALID_USERNAME_OR_PASSWORD: "invalidCredentials",
  INVALID_EMAIL_OR_PASSWORD: "invalidCredentials",
  EMAIL_NOT_VERIFIED: "emailNotVerified",
  USERNAME_IS_ALREADY_TAKEN: "usernameTaken",
  USER_ALREADY_EXISTS: "emailTaken",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "emailTaken",
  EMAIL_ALREADY_IN_USE: "emailTaken",
  INVALID_USERNAME: "invalidUsername",
  INVALID_DISPLAY_USERNAME: "invalidUsername",
  USERNAME_TOO_SHORT: "invalidUsername",
  USERNAME_TOO_LONG: "invalidUsername",
  INVALID_EMAIL: "invalidEmail",
  PASSWORD_TOO_SHORT: "passwordTooShort",
  PASSWORD_TOO_LONG: "passwordTooLong",
  ACCOUNT_BANNED: "banned",
  RATE_LIMITED: "rateLimited",
  RESET_PASSWORD_DISABLED: "mailOff",
  VERIFICATION_EMAIL_NOT_ENABLED: "mailOff",
  INVALID_TOKEN: "invalidToken",
};

async function describe(code: string | undefined) {
  const t = await getTranslations("auth.actions.errors");
  return t(((code && ERRORS[code]) || "generic") as "generic");
}

async function failure(result: { code?: string }, username: string) {
  return { error: await describe(result.code), username };
}

export async function login(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const t = await getTranslations("auth.actions.errors");
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) {
    return { error: t("invalidCredentials"), username };
  }
  const remember = formData.get("remember") !== null;
  const result = username.includes("@")
    ? await signInWithEmail(username, password, remember)
    : await signInWithUsername(username, password, remember);
  if (!result.ok) return failure(result, username);
  redirect(safeReturnPath(formData.get("next")));
}

export async function register(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const t = await getTranslations("auth.actions.errors");
  const username = String(formData.get("username") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !email || !password) {
    return { error: t("passwordRequired"), username };
  }
  if (!formData.get("terms")) return { error: t("termsRequired"), username };
  // The member whose link brought the visitor travels with the sign-up, and the backend decides
  // whether and when it counts. The cookie, kept once the visitor accepted it, was set by the
  // first link they followed and so wins; without it the form carries the `?ref=` of the page.
  const store = await cookies();
  // The proxy removes a cookie that is no longer accepted on the next page load, which may come
  // after this request: consent is checked here too.
  const accepted = mayStoreReferral(
    parseConsent(store.get(CONSENT_COOKIE)?.value, POLICY_VERSION),
  );
  const referrer =
    (accepted ? referrerOf(store.get(REFERRAL_COOKIE)?.value) : null) ??
    referrerOf(String(formData.get("ref") ?? ""));
  const result = await signUp({
    username,
    email,
    password,
    ...(referrer === null ? {} : { ref: referrer }),
  });
  if (!result.ok) return failure(result, username);
  if (store.has(REFERRAL_COOKIE)) store.delete(REFERRAL_COOKIE);
  redirect(result.signedIn ? "/" : "/login?registered=1");
}

export type FormState = { error: string } | null;

// Better Auth answers a malformed address (not the lack of an account) with this code.
const MALFORMED = "VALIDATION_ERROR";

async function emailFailure(code: string | undefined) {
  const t = await getTranslations("auth.actions.errors");
  return {
    error: code === MALFORMED ? t("invalidEmail") : await describe(code),
  };
}

// The answer never depends on whether the address has an account.
export async function forgotPassword(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("auth.forgotPassword");
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: t("errors.required") };
  const result = await requestPasswordReset(email);
  if (!result.ok) return emailFailure(result.code);
  redirect("/forgot-password?sent=1");
}

export async function choosePassword(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("auth.actions.errors");
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!token) redirect("/reset-password?error=INVALID_TOKEN");
  if (!password) return { error: t("passwordRequired") };
  if (password !== confirm) return { error: t("passwordMismatch") };
  const result = await resetPassword(token, password);
  if (!result.ok) {
    if (result.code === "INVALID_TOKEN") {
      redirect("/reset-password?error=INVALID_TOKEN");
    }
    return { error: await describe(result.code) };
  }
  redirect("/login?reset=1");
}

// For a visitor who has no session, so it needs the address. A signed-in member who asks for an
// address that is not theirs, or one already confirmed, gets the same answer as everyone.
const NEUTRAL = ["EMAIL_ALREADY_VERIFIED", "EMAIL_MISMATCH"];

export async function resendVerification(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("auth.actions.errors");
  const email = String(formData.get("email") ?? "").trim();
  const from = formData.get("from") === "verify" ? "/verify-email" : "/login";
  if (!email) return { error: t("invalidEmail") };
  const result = await sendVerificationEmail(email);
  if (!result.ok && !(result.code && NEUTRAL.includes(result.code))) {
    return emailFailure(result.code);
  }
  redirect(`${from}?resent=1`);
}
