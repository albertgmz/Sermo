"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  changeUsername,
  setAppearance,
  setSignature,
  setTitle,
} from "@/lib/db";
import { can, TITLE_MAX_LENGTH } from "@/lib/permissions";
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
  redirect(`/account/appearance?saved=${field}`);
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
  redirect("/account/permissions?saved=signature#signature");
}

export type TitleState = {
  error: "not_found" | "not_allowed" | "too_long";
} | null;

export type UsernameState = {
  error: "not_found" | "not_allowed" | "invalid" | "taken" | "unconfirmed";
} | null;

export type DetailsState =
  | { field: "username"; error: NonNullable<UsernameState>["error"] }
  | {
      field: "title";
      error: NonNullable<TitleState>["error"];
      usernameSaved?: boolean;
    }
  | null;

export async function saveDetails(
  _previous: DetailsState,
  formData: FormData,
): Promise<DetailsState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const username = String(formData.get("username") ?? user.username).trim();
  const title = String(formData.get("title") ?? user.customTitle ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const usernameChanged = username !== user.username;
  const titleChanged = title !== (user.customTitle ?? "");

  // Validate the title before spending a username change.
  if (titleChanged) {
    if (!can(user, "customTitle")) {
      return { field: "title", error: "not_allowed" };
    }
    if (title.length > TITLE_MAX_LENGTH) {
      return { field: "title", error: "too_long" };
    }
  }
  if (usernameChanged) {
    if (formData.get("confirm") !== "on") {
      return { field: "username", error: "unconfirmed" };
    }
    const result = await changeUsername(user.id, username);
    if (!result.ok) return { field: "username", error: result.error };
  }
  if (titleChanged) {
    const result = await setTitle(user.id, title);
    if (!result.ok) {
      if (usernameChanged) revalidatePath("/", "layout");
      return {
        field: "title",
        error: result.error,
        usernameSaved: usernameChanged,
      };
    }
  }
  revalidatePath("/", "layout");
  redirect("/account?saved=details");
}
