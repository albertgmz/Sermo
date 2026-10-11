"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ReactionTarget, setReaction } from "@/lib/db";
import { getCurrentUser, signOut } from "@/lib/session";

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
