"use server";

import { redirect } from "next/navigation";
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
  const username = String(formData.get("username") ?? "").trim();
  const user = username ? await getUser(username) : null;
  if (!user) {
    return { error: "No member found with that name.", username };
  }
  await signIn(user.id);
  redirect("/");
}

export async function register(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const username = String(formData.get("username") ?? "").trim();
  if (!USERNAME_PATTERN.test(username)) {
    return {
      error: "Use 3 to 20 letters, numbers, dashes or underscores.",
      username,
    };
  }
  if (!EMAIL.test(String(formData.get("email") ?? "").trim())) {
    return { error: "Enter a valid email address.", username };
  }
  if (!formData.get("password")) {
    return { error: "Enter a password.", username };
  }
  const user = await createUser({ username, client: await getClientInfo() });
  if (!user) return { error: "That username is already taken.", username };
  await signIn(user.id);
  redirect("/");
}
