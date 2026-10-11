"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { markNotificationsRead } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

// The form sits in the header panel too, so the member goes back to the page
// they sent it from.
async function origin() {
  const referer = (await headers()).get("referer");
  if (!referer || !URL.canParse(referer)) return "/notifications";
  const { pathname, search } = new URL(referer);
  return pathname.startsWith("//") ? "/notifications" : pathname + search;
}

export async function markAllRead() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await markNotificationsRead(user.id);
  revalidatePath("/", "layout");
  redirect(await origin());
}
