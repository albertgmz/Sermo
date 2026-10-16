"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  isHydrated,
  type Refusal,
  refusedAddress,
} from "@/app/[locale]/(auth)/native-form";
import { REFERRAL_COOKIE } from "@/lib/consent/inventory";
import { getConsent } from "@/lib/consent/server";
import { mayStoreReferral } from "@/lib/consent/state";
import { syncConsentAfterSignIn } from "@/lib/consent/sync";
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
import { tokenOf } from "@/lib/turnstile/field";

// `assign`: go to this address with a full page load (see `useHardNavigation`).
export type AuthState = { error: string; username: string; assign?: string };

// Better Auth's error code to the key under auth.actions.errors.
const ERRORS: Record<string, Refusal> = {
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
  TURNSTILE_REQUIRED: "turnstileRequired",
  TURNSTILE_FAILED: "turnstileFailed",
  TURNSTILE_UNAVAILABLE: "turnstileUnavailable",
};

const keyOf = (code: string | undefined): Refusal =>
  (code && ERRORS[code]) || "generic";

// A form that was sent without the page's script gets a redirect to `page` that names the refusal
// (see `native-form.ts`): there is no page for a returned state to be drawn in. `params` are what
// the page needs to draw the same form again. The hydrated form gets the state, with the message
// in `text` when it has a wording of its own.
type Retry = {
  username?: string;
  params?: Record<string, string>;
  text?: string;
};

async function refuse(
  formData: FormData,
  page: string,
  key: Refusal,
  options: Retry = {},
) {
  if (!isHydrated(formData))
    redirect(refusedAddress(page, key, options.params));
  const t = await getTranslations("auth.actions.errors");
  return { error: options.text ?? t(key) };
}

// The same for the forms that keep what was typed in the name field.
async function refuseKeeping(
  formData: FormData,
  page: string,
  key: Refusal,
  options: Retry,
) {
  return {
    ...(await refuse(formData, page, key, options)),
    username: options.username ?? "",
  };
}

// An address has one "@" and a dot after it. Imported usernames may hold an "@" with no dot after
// it, so the sign-in tells the two apart by shape.
const EMAIL_ADDRESS = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function login(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeReturnPath(formData.get("next"));
  const again: Retry = { username, params: next === "/" ? {} : { next } };
  if (!username || !password) {
    return refuseKeeping(formData, "/login", "invalidCredentials", again);
  }
  const remember = formData.get("remember") !== null;
  const result = EMAIL_ADDRESS.test(username)
    ? await signInWithEmail(username, password, remember, tokenOf(formData))
    : await signInWithUsername(username, password, remember, tokenOf(formData));
  if (!result.ok)
    return refuseKeeping(formData, "/login", keyOf(result.code), again);
  const adopted =
    result.signedIn && (await syncConsentAfterSignIn(result.cookie));
  // The banner running in this page started without a choice; only a full load lets it read the
  // one just adopted, so its dialog does not stay open over a page drawn for a visitor who chose.
  // A form sent without the page's script has no client to load the page: its redirect is a full
  // load already.
  if (adopted && isHydrated(formData))
    return { error: "", username, assign: next };
  redirect(next);
}

export async function register(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const username = String(formData.get("username") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const ref = String(formData.get("ref") ?? "");
  const again: Retry = { username, params: ref ? { ref } : {} };
  if (!username || !email || !password) {
    return refuseKeeping(formData, "/register", "passwordRequired", again);
  }
  if (!formData.get("terms")) {
    return refuseKeeping(formData, "/register", "termsRequired", again);
  }
  // The member whose link brought the visitor travels with the sign-up, and the backend decides
  // whether and when it counts. The cookie, kept once the visitor accepted it, was set by the
  // first link they followed and so wins; without it the form carries the `?ref=` of the page.
  const store = await cookies();
  // The proxy removes a cookie that is no longer accepted on the next page load, which may come
  // after this request: consent is checked here too.
  const accepted = mayStoreReferral(await getConsent());
  const referrer =
    (accepted ? referrerOf(store.get(REFERRAL_COOKIE)?.value) : null) ??
    referrerOf(ref);
  const result = await signUp(
    {
      username,
      email,
      password,
      acceptTerms: true,
      ...(referrer === null ? {} : { ref: referrer }),
    },
    tokenOf(formData),
  );
  if (!result.ok) {
    return refuseKeeping(formData, "/register", keyOf(result.code), again);
  }
  if (store.has(REFERRAL_COOKIE)) store.delete(REFERRAL_COOKIE);
  const adopted =
    result.signedIn && (await syncConsentAfterSignIn(result.cookie));
  if (adopted && isHydrated(formData))
    return { error: "", username, assign: "/" };
  redirect(result.signedIn ? "/" : "/login?registered=1");
}

export type FormState = { error: string } | null;

// Better Auth answers a malformed address (not the lack of an account) with this code.
const MALFORMED = "VALIDATION_ERROR";

const emailKey = (code: string | undefined): Refusal =>
  code === MALFORMED ? "invalidEmail" : keyOf(code);

// The answer never depends on whether the address has an account.
export async function forgotPassword(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const t = await getTranslations("auth.forgotPassword");
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return refuse(formData, "/forgot-password", "invalidEmail", {
      text: t("errors.required"),
    });
  }
  const result = await requestPasswordReset(email, tokenOf(formData));
  if (!result.ok) {
    return refuse(formData, "/forgot-password", emailKey(result.code));
  }
  redirect("/forgot-password?sent=1");
}

export async function choosePassword(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!token) redirect("/reset-password?error=INVALID_TOKEN");
  const again: Retry = { params: { token } };
  if (!password) {
    return refuse(formData, "/reset-password", "passwordRequired", again);
  }
  if (password !== confirm) {
    return refuse(formData, "/reset-password", "passwordMismatch", again);
  }
  const result = await resetPassword(token, password);
  if (!result.ok) {
    if (result.code === "INVALID_TOKEN") {
      redirect("/reset-password?error=INVALID_TOKEN");
    }
    return refuse(formData, "/reset-password", keyOf(result.code), again);
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
  const email = String(formData.get("email") ?? "").trim();
  const from = formData.get("from") === "verify" ? "/verify-email" : "/login";
  // The sign-in page shows this form after a sign-up only.
  const again: Retry = {
    params: from === "/login" ? { registered: "1", form: "resend" } : {},
  };
  if (!email) return refuse(formData, from, "invalidEmail", again);
  const result = await sendVerificationEmail(email, tokenOf(formData));
  if (!result.ok && !(result.code && NEUTRAL.includes(result.code))) {
    return refuse(formData, from, emailKey(result.code), again);
  }
  redirect(`${from}?resent=1`);
}
