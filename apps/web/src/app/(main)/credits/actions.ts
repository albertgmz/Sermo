"use server";

import { appearanceSet, shopBuy, shopUse } from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { call } from "@/lib/sermo/client";
import { isRecordId, parseId } from "@/lib/sermo/ids";
import { attempt, invalidArgument } from "@/lib/sermo/outcome";
import { safeReturnPath } from "@/lib/sermo/return-path";

export type CreditsState = { error?: string };

// The page a mutation came from, with the notice that says what happened. The path is the one
// that was checked, kept as written (a URL parser would resolve dot segments in it); only its
// query is rewritten, and it keeps the cursor of the list the member was on.
function back(returnTo: string, notice: string): never {
  const [target] = safeReturnPath(returnTo).split("#");
  const mark = target.indexOf("?");
  const pathname = mark < 0 ? target : target.slice(0, mark);
  const query = new URLSearchParams(mark < 0 ? "" : target.slice(mark + 1));
  query.set("notice", notice);
  revalidatePath("/", "layout");
  redirect(`${pathname}?${query}`);
}

// The parts of the appearance an item unlocks, which are the only ones the shop pages wear.
const LOOKS = ["frameId", "nameColorId"] as const;

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
  return back(returnTo, "bought");
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
  return back(returnTo, id === null ? "removed" : "worn");
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
  return back(returnTo, "used");
}
