"use server";

import {
  shopCategoriesCreate,
  shopCategoriesDelete,
  shopCategoriesUpdate,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import {
  formFailure,
  type OrderChange,
  ruleOf,
  ruleRefusal,
  saveInOrder,
  text,
  whole,
} from "../../groups/form-errors";

const FIELDS = ["name", "description", "position", "isActive", "rule"];
const PATH = "/admin/shop/categories";

// A new category (no id) or a change of one. A new category takes its place from `position`
// (empty is the backend's default); an existing one is moved with "Save order", so its form
// does not carry the position.
export async function saveCategory(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.categories.errors");
  const raw = text(formData, "id");
  const categoryId = raw === "" ? null : parseId(raw);
  if (raw !== "" && categoryId === null) return { error: t("id") };
  const typed = text(formData, "position").trim();
  const position = typed === "" ? undefined : whole(typed);
  if (position === null) return { fields: { position: t("whole") } };
  const rule = ruleOf(formData);
  if (rule === null) return ruleRefusal(formData);
  const fields = {
    name: text(formData, "name"),
    description: text(formData, "description"),
    isActive: formData.get("isActive") !== null,
    rule,
  };
  try {
    if (categoryId === null) {
      await call(shopCategoriesCreate, {
        ...fields,
        ...(position !== undefined && { position }),
      });
    } else {
      await call(shopCategoriesUpdate, { categoryId, ...fields });
    }
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  redirect(`${PATH}?notice=${categoryId === null ? "created" : "saved"}`);
}

// "Save order": the categories whose number was changed from what the page showed
// (`before:<id>`), each saved on its own.
export async function saveCategoryOrder(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.categories.errors");
  const changes: OrderChange[] = [];
  const fields: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (!name.startsWith("position:") || typeof value !== "string") continue;
    const categoryId = parseId(name.slice("position:".length));
    if (categoryId === null) return { error: t("id") };
    if (value.trim() === text(formData, `before:${categoryId}`).trim())
      continue;
    const position = whole(value);
    if (position === null) fields[name] = t("whole");
    else {
      changes.push({
        title: text(formData, `title:${categoryId}`) || `#${categoryId}`,
        save: () => call(shopCategoriesUpdate, { categoryId, position }),
      });
    }
  }
  if (Object.keys(fields).length > 0) return { fields };
  const { state } = await saveInOrder(changes);
  if (state) return state;
  redirect(`${PATH}?notice=ordered`);
}

// Delete a category; the backend refuses one that still has items and says so.
export async function deleteCategory(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.categories.errors");
  const categoryId = parseId(text(formData, "id"));
  if (categoryId === null) return { error: t("id") };
  try {
    await call(shopCategoriesDelete, { categoryId });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(`${PATH}?notice=deleted`);
}
