"use server";

import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getClientInfo } from "@/lib/client";
import { createUser, getUser } from "@/lib/db";
import { USERNAME_PATTERN } from "@/lib/permissions";
import { signIn } from "@/lib/session";

export type AuthState = { error: string; username: string };

const EMAIL = /^\S+@\S+\.\S+$/;

export async function login(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const t = await getTranslations("auth.actions.errors");
  const username = String(formData.get("username") ?? "").trim();
  const user = username ? await getUser(username) : null;
  if (!user) {
    return { error: t("memberNotFound"), username };
  }
  await signIn(user.id);
  redirect("/");
}

export async function register(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const t = await getTranslations("auth.actions.errors");
  const username = String(formData.get("username") ?? "").trim();
  if (!USERNAME_PATTERN.test(username)) {
    return {
      error: t("invalidUsername"),
      username,
    };
  }
  if (!EMAIL.test(String(formData.get("email") ?? "").trim())) {
    return { error: t("invalidEmail"), username };
  }
  if (!formData.get("password")) {
    return { error: t("passwordRequired"), username };
  }
  const user = await createUser({ username, client: await getClientInfo() });
  if (!user) return { error: t("usernameTaken"), username };
  await signIn(user.id);
  redirect("/");
}
