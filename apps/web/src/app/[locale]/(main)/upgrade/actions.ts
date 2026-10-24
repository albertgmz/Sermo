"use server";

import { shopUpgrade } from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { call } from "@/lib/sermo/client";
import { isRecordId } from "@/lib/sermo/ids";
import { attempt, invalidArgument } from "@/lib/sermo/outcome";

// `notice`: the rank is the member's, which the page's notice says in place (`PageNotice`).
export type RankState = { error?: string; notice?: "upgraded" };

// Buys the rank at full price or, over a rank held, for the difference: the backend works out which.
export async function buyRank(
  itemId: number,
  _previous: RankState,
): Promise<RankState> {
  if (!isRecordId(itemId)) return { error: await invalidArgument() };
  const bought = await attempt("/upgrade", () => call(shopUpgrade, { itemId }));
  if (!bought.ok) return { error: bought.error };
  // The rank shows wherever the member does (the header, the ladder, every post): all of it is
  // read again, in the action's own answer, and the page stays where it is.
  revalidatePath("/", "layout");
  return { notice: "upgraded" };
}
