"use server";

import { shopUpgrade } from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { call } from "@/lib/sermo/client";
import { isRecordId } from "@/lib/sermo/ids";
import { attempt, invalidArgument } from "@/lib/sermo/outcome";

export type RankState = { error?: string };

// Buys the rank at full price or, over a rank held, for the difference: the backend works out which.
export async function buyRank(
  itemId: number,
  _previous: RankState,
): Promise<RankState> {
  if (!isRecordId(itemId)) return { error: await invalidArgument() };
  const bought = await attempt("/upgrade", () => call(shopUpgrade, { itemId }));
  if (!bought.ok) return { error: bought.error };
  revalidatePath("/", "layout");
  redirect("/upgrade?notice=upgraded");
}
