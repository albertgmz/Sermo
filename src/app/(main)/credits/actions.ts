"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  applyBoost,
  applyThreadCover,
  getInventory,
  getShopItems,
  type PurchaseFailure,
  purchaseItem,
  setAppearance,
} from "@/lib/db";
import { getCurrentUser } from "@/lib/session";
import type { Appearance, ShopEffect } from "@/lib/types";

export type PurchaseState = PurchaseFailure | null;

export async function buyItem(
  itemId: number,
  _previous: PurchaseState,
  _formData: FormData,
): Promise<PurchaseState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const item = (await getShopItems()).find((i) => i.id === itemId);
  if (!item) return { ok: false, error: "not_found" };
  const result = await purchaseItem(user.id, item.id);
  if (!result.ok) return result;
  revalidatePath("/", "layout");
  redirect(`/credits?category=${item.category}`);
}

export type EquipState = { error: "not_owned" | "invalid" } | null;

function appearancePatch(
  effect: ShopEffect,
  equip: boolean,
): Partial<Appearance> | null {
  switch (effect.type) {
    case "frame":
      return { frame: equip ? effect.frame : null };
    case "nameColor":
      return { nameColor: equip ? effect.color : null };
    default:
      return null;
  }
}

export async function equipItem(
  itemId: number,
  equip: boolean,
  from: "shop" | "inventory",
  _previous: EquipState,
  _formData: FormData,
): Promise<EquipState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const item = (await getInventory(user.id)).find((i) => i.id === itemId);
  if (!item) return { error: "not_owned" };
  const patch = appearancePatch(item.effect, equip === true);
  if (!patch) return { error: "invalid" };
  const result = await setAppearance(user.id, patch);
  if (!result.ok) {
    return { error: result.error === "not_owned" ? "not_owned" : "invalid" };
  }
  revalidatePath("/", "layout");
  redirect(
    from === "inventory"
      ? "/credits?tab=inventory"
      : `/credits?category=${item.category}`,
  );
}

export type BoostState = {
  error: "no_thread" | "not_found" | "not_owned" | "not_author";
} | null;

export async function spendBoost(
  itemId: number,
  _previous: BoostState,
  formData: FormData,
): Promise<BoostState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const threadId = Number(formData.get("thread"));
  if (!Number.isInteger(threadId) || threadId < 1) {
    return { error: "no_thread" };
  }
  if (!Number.isInteger(itemId)) return { error: "not_found" };
  const item = (await getShopItems()).find((i) => i.id === itemId);
  const result =
    item?.category === "threadCover"
      ? await applyThreadCover(user.id, itemId, threadId)
      : await applyBoost(user.id, itemId, threadId);
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  redirect(`/credits?tab=inventory&applied=${itemId}&thread=${threadId}`);
}
