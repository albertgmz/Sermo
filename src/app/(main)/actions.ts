"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type ReactionTarget, setReaction } from "@/lib/db";
import { LITE_COOKIE } from "@/lib/lite-mode";
import { getCurrentUser, signOut } from "@/lib/session";

export async function setLiteMode(formData: FormData) {
  const store = await cookies();
  if (formData.get("enabled") === "1") {
    store.set(LITE_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  } else {
    store.delete(LITE_COOKIE);
  }
  const returnTo = String(formData.get("returnTo") ?? "/");
  redirect(
    returnTo.startsWith("/") && !/^\/[\\/]|[\s\\]/.test(returnTo)
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
