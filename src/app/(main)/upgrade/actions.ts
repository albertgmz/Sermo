"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { purchaseRank, type RankResult } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export type RankState = Extract<RankResult, { ok: false }> | null;

export async function buyRank(
  rankId: number,
  _previous: RankState,
  _formData: FormData,
): Promise<RankState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!Number.isInteger(rankId)) return { ok: false, error: "not_found" };
  const result = await purchaseRank(user.id, rankId);
  if (!result.ok) return result;
  revalidatePath("/", "layout");
  redirect("/upgrade");
}
