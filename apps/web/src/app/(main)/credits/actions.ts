"use server";

import { appearanceSet, shopBuy, shopUse } from "@sermo/core/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { call } from "@/lib/sermo/client";
import { attempt } from "@/lib/sermo/outcome";
import { safeReturnPath } from "@/lib/sermo/return-path";

export type CreditsState = { error?: string };

// The page a mutation came from, with the notice that says what happened.
function back(returnTo: string, notice: string): never {
  const url = new URL(safeReturnPath(returnTo), "http://localhost");
  url.searchParams.set("notice", notice);
  revalidatePath("/", "layout");
  redirect(`${url.pathname}${url.search}`);
}

export async function buyItem(
  itemId: number,
  returnTo: string,
  _previous: CreditsState,
  formData: FormData,
): Promise<CreditsState> {
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
  look: "frameId" | "nameColorId",
  id: number | null,
  returnTo: string,
  _previous: CreditsState,
): Promise<CreditsState> {
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
  const used = await attempt(returnTo, () =>
    call(shopUse, {
      inventoryId,
      threadId: thread ? Number(thread) : undefined,
    }),
  );
  if (!used.ok) return { error: used.error };
  return back(returnTo, "used");
}
