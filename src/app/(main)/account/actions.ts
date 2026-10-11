"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  changeUsername,
  setAppearance,
  setSignature,
  setTitle,
} from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import type { Appearance } from "@/lib/types";

const FIELDS = ["accent", "frame", "nameColor", "cover"] as const;

export type AppearanceField = (typeof FIELDS)[number];

export type AppearanceState = {
  error: "not_found" | "invalid" | "not_owned" | "not_allowed";
} | null;

export async function saveAppearance(
  field: AppearanceField,
  _previous: AppearanceState,
  formData: FormData,
): Promise<AppearanceState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const raw = formData.get("value");
  if (!FIELDS.includes(field) || typeof raw !== "string") {
    return { error: "invalid" };
  }
  // An empty value clears the choice.
  const patch: Partial<Appearance> = { [field]: raw || null };
  const result = await setAppearance(user.id, patch);
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  redirect(`/account?saved=${field}#appearance`);
}

export type SignatureState = {
  error: "not_found" | "not_allowed" | "too_long" | "too_many_lines";
} | null;

export async function saveSignature(
  _previous: SignatureState,
  formData: FormData,
): Promise<SignatureState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const body = formData.has("clear") ? "" : formData.get("signature");
  const result = await setSignature(user.id, String(body ?? ""));
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  redirect("/account?saved=signature#signature");
}

export type TitleState = {
  error: "not_found" | "not_allowed" | "too_long";
} | null;

export async function saveTitle(
  _previous: TitleState,
  formData: FormData,
): Promise<TitleState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const title = formData.has("reset") ? "" : formData.get("title");
  const result = await setTitle(user.id, String(title ?? ""));
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  redirect("/account?saved=title#title");
}

export type UsernameState = {
  error: "not_found" | "not_allowed" | "invalid" | "taken" | "unconfirmed";
} | null;

export async function saveUsername(
  _previous: UsernameState,
  formData: FormData,
): Promise<UsernameState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (formData.get("confirm") !== "on") return { error: "unconfirmed" };
  const result = await changeUsername(
    user.id,
    String(formData.get("username") ?? ""),
  );
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  redirect("/account?saved=username#username");
}
