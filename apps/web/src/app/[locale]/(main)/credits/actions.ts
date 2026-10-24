"use server";

import { appearanceSet, shopBuy, shopUse } from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { call } from "@/lib/sermo/client";
import { isRecordId, parseId } from "@/lib/sermo/ids";
import { attempt, invalidArgument } from "@/lib/sermo/outcome";

// `notice` says what was done, for the page's notice (`PageNotice`): the item's card and the
// balance are drawn again where they are, and the page stays where it is.
export type CreditsState = { error?: string; notice?: CreditsNotice };

export type CreditsNotice = "bought" | "worn" | "removed" | "used";

// A mutation that worked: the pages that show the balance and what the member wears (the header,
// the shop's cards, the inventory) are read again, in the action's own answer.
function done(notice: CreditsNotice): CreditsState {
  revalidatePath("/", "layout");
  return { notice };
}

// The parts of the appearance an item unlocks, which are the only ones the shop pages wear.
const LOOKS = ["frameId", "nameColorId", "nameIconItemId"] as const;

export async function buyItem(
  itemId: number,
  returnTo: string,
  _previous: CreditsState,
  formData: FormData,
): Promise<CreditsState> {
  if (!isRecordId(itemId)) return { error: await invalidArgument() };
  const quantity = Number(formData.get("quantity") ?? 1);
  const bought = await attempt(returnTo, () =>
    call(shopBuy, { itemId, quantity }),
  );
  if (!bought.ok) return { error: bought.error };
  return done("bought");
}

// `look` is the part of the appearance the item unlocks; `id` is the catalog entry to wear, or
// nothing to take it off.
export async function wearItem(
  look: (typeof LOOKS)[number],
  id: number | null,
  returnTo: string,
  _previous: CreditsState,
): Promise<CreditsState> {
  if (!LOOKS.includes(look) || (id !== null && !isRecordId(id))) {
    return { error: await invalidArgument() };
  }
  const worn = await attempt(returnTo, () =>
    call(appearanceSet, { [look]: id }),
  );
  if (!worn.ok) return { error: worn.error };
  return done(id === null ? "removed" : "worn");
}

export async function spendItem(
  inventoryId: number,
  returnTo: string,
  _previous: CreditsState,
  formData: FormData,
): Promise<CreditsState> {
  const thread = String(formData.get("thread") ?? "");
  const threadId = thread ? parseId(thread) : undefined;
  if (!isRecordId(inventoryId) || threadId === null) {
    return { error: await invalidArgument() };
  }
  const used = await attempt(returnTo, () =>
    call(shopUse, { inventoryId, threadId }),
  );
  if (!used.ok) return { error: used.error };
  return done("used");
}
