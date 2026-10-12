"use server";

import { usersSetReferrer } from "@sermo/core/contracts";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  type AuthResult,
  signInWithEmail,
  signInWithUsername,
  signUp,
} from "@/lib/sermo/auth";
import { forwardFromRequest } from "@/lib/sermo/client";
import { safeReturnPath } from "@/lib/sermo/return-path";
import { callWith } from "@/lib/sermo/transport";

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
};

async function failure(result: AuthResult, username: string) {
  const t = await getTranslations("auth.actions.errors");
  const key = (result.code && ERRORS[result.code]) || "generic";
  return { error: t(key as "generic"), username };
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

// Names the member whose link brought the visitor here. A courtesy, not part of signing up: a
// refusal changes nothing the visitor sees. The session the sign-up just opened is in the cookie
// jar, not in the request headers.
async function refer(value: FormDataEntryValue | null) {
  const userId = Number(value);
  if (!Number.isSafeInteger(userId) || userId < 1) return;
  try {
    await callWith(
      {
        ...(await forwardFromRequest()),
        cookie: (await cookies()).toString(),
      },
      usersSetReferrer,
      { userId },
    );
  } catch {}
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
  const result = await signUp({ username, email, password });
  if (!result.ok) return failure(result, username);
  if (result.signedIn) await refer(formData.get("ref"));
  redirect(result.signedIn ? "/" : "/login?registered=1");
}
