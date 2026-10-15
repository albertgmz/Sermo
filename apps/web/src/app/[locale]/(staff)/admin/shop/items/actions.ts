"use server";

import {
  imagesSetShopItemImage,
  type ShopEffect,
  shopItemsCreate,
  shopItemsDelete,
  shopItemsUpdate,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import {
  formFailure,
  ruleOf,
  ruleRefusal,
  text,
  whole,
} from "../../groups/form-errors";

const FIELDS = [
  "categoryId",
  "name",
  "description",
  "price",
  "stock",
  "isConsumable",
  "isGiftable",
  "durationSeconds",
  "effect",
  "position",
  "isActive",
  "rule",
];
const PATH = "/admin/shop/items";

type Effect = z.input<typeof ShopEffect>;

const SECONDS = {
  seconds: 1,
  minutes: 60,
  hours: 3_600,
  days: 86_400,
} as const;

// The effect the form showed, from the fields of its type; null names the field that is wrong.
// The contract's list of types decides what is accepted, and the backend what is valid.
function effectOf(formData: FormData): Effect | null {
  const id = (name: string) => parseId(text(formData, name));
  const type = text(formData, "effectType");
  switch (type) {
    case "frame": {
      const frameId = id("frameId");
      return frameId === null ? null : { type, frameId };
    }
    case "nameColor": {
      const colorId = id("colorId");
      return colorId === null ? null : { type, colorId };
    }
    case "nameIcon": {
      const icon = text(formData, "icon").trim();
      const position = text(formData, "iconPosition");
      if (icon === "" || (position !== "before" && position !== "after"))
        return null;
      return { type, icon, position };
    }
    case "threadCover": {
      const coverId = id("coverId");
      return coverId === null ? null : { type, coverId };
    }
    case "group": {
      const groupId = id("groupId");
      return groupId === null ? null : { type, groupId };
    }
    case "permission": {
      const permission = text(formData, "permission").trim();
      if (permission === "") return null;
      const typed = text(formData, "permissionValue").trim();
      if (typed === "") return { type, permission };
      const value = whole(typed);
      return value === null ? null : { type, permission, value };
    }
    case "highlight": {
      const days = whole(text(formData, "days"));
      return days === null ? null : { type, days };
    }
    case "bump":
    case "promote":
    case "usernameChange":
      return { type };
    default:
      return null;
  }
}

// A new item (no id) or a change of one. A new picture is the file uploaded first; it is
// attached after the item is saved, which is the only moment an item has an id.
export async function saveItem(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.items.errors");
  const raw = text(formData, "id");
  const itemId = raw === "" ? null : parseId(raw);
  if (raw !== "" && itemId === null) return { error: t("id") };
  const categoryId = parseId(text(formData, "categoryId"));
  if (categoryId === null) return { fields: { categoryId: t("category") } };
  const price = whole(text(formData, "price").trim());
  if (price === null) return { fields: { price: t("number") } };
  const position = whole(text(formData, "position").trim());
  if (position === null) return { fields: { position: t("number") } };
  const typedStock = text(formData, "stock").trim();
  const stock = typedStock === "" ? null : whole(typedStock);
  if (typedStock !== "" && stock === null) {
    return { fields: { stock: t("number") } };
  }
  const effect = effectOf(formData);
  if (effect === null) return { fields: { effect: t("effect") } };
  const rule = ruleOf(formData);
  if (rule === null) return ruleRefusal(formData);
  const typedFile = text(formData, "fileId");
  const fileId = typedFile === "" ? undefined : parseId(typedFile);
  if (fileId === null) return { error: t("file") };
  const removePicture = text(formData, "fileIdRemove") === "1";

  // The duration is shown only for an item that is not a consumable.
  const isConsumable = formData.get("isConsumable") !== null;
  let durationSeconds: number | null = null;
  const amount = text(formData, "durationAmount").trim();
  const unchangedDuration =
    !isConsumable &&
    `${amount}:${text(formData, "durationUnit")}` ===
      text(formData, "durationWas");
  if (!isConsumable && amount !== "") {
    const unit = text(formData, "durationUnit");
    const count = whole(amount);
    if (count === null || !Object.hasOwn(SECONDS, unit)) {
      return { fields: { durationSeconds: t("number") } };
    }
    durationSeconds = count * SECONDS[unit as keyof typeof SECONDS];
  }

  const fields = {
    categoryId,
    name: text(formData, "name"),
    description: text(formData, "description"),
    price,
    isActive: formData.get("isActive") !== null,
    stock,
    isConsumable,
    isGiftable: formData.get("isGiftable") !== null,
    // An item whose duration the administrator did not touch keeps the one it has: the form can
    // only show it in whole units, and saving what it shows could change it.
    ...(itemId !== null && unchangedDuration ? {} : { durationSeconds }),
    effect,
    position,
    rule,
  };
  let saved: number;
  try {
    saved = (
      itemId === null
        ? await call(shopItemsCreate, fields)
        : await call(shopItemsUpdate, { itemId, ...fields })
    ).id;
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  let pictureRefused = false;
  if (fileId != null || (removePicture && itemId !== null)) {
    try {
      await call(imagesSetShopItemImage, {
        itemId: saved,
        fileId: fileId ?? null,
      });
    } catch (error) {
      // The item is saved; a second submit of this form would create it again.
      if (itemId === null) pictureRefused = true;
      else return formFailure(error, ["fileId"]);
    }
  }
  if (itemId === null) {
    redirect(
      pictureRefused
        ? `${PATH}/${saved}?notice=createdNoPicture`
        : `${PATH}?category=${categoryId}&notice=created`,
    );
  }
  redirect(`${PATH}/${saved}?notice=saved`);
}

// Delete an item; the backend refuses one that was bought, which can only be deactivated.
export async function deleteItem(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.items.errors");
  const itemId = parseId(text(formData, "id"));
  if (itemId === null) return { error: t("id") };
  try {
    await call(shopItemsDelete, { itemId });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(`${PATH}?notice=deleted`);
}
