"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type ReactionTarget, setReaction } from "@/lib/db";
import { normalizeImagePath } from "@/lib/lite-images";
import {
  LITE_COOKIE,
  parseLiteCookieHeader,
  serializeLiteCookie,
  updateLiteState,
} from "@/lib/lite-preferences";
import { getCurrentUser, signOut } from "@/lib/session";

export async function setLiteMode(formData: FormData) {
  const store = await cookies();
  const mode = formData.get("mode");
  const categories = formData.getAll("category");
  const state = updateLiteState(
    parseLiteCookieHeader(store.toString()),
    mode,
    categories,
    formData.get("source") === "settings",
  );
  if (state) {
    const value = serializeLiteCookie(state);
    if (value) {
      store.set(LITE_COOKIE, value, {
        httpOnly: false,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    } else {
      store.delete(LITE_COOKIE);
    }
  }
  const returnTo = String(formData.get("returnTo") ?? "/");
  const path = normalizeImagePath(returnTo.split(/[?#]/)[0]);
  redirect(
    returnTo.startsWith("/") &&
      !/^\/[\\/]|[\s\\]/.test(returnTo) &&
      path !== "/_next" &&
      !path.startsWith("/_next/")
      ? returnTo
      : "/",
  );
}

export async function logout() {
  await signOut();
  redirect("/");
}

const TARGETS: ReactionTarget[] = [
  "post",
  "profilePost",
  "profileComment",
  "message",
];

export async function react(
  target: ReactionTarget,
  id: number,
  typeId: number | null,
) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!TARGETS.includes(target)) return;
  await setReaction({ target, id, userId: user.id, typeId });
  revalidatePath("/", "layout");
}
