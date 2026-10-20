"use server";

import {
  awardCategoriesCreate,
  awardCategoriesDelete,
  awardCategoriesUpdate,
} from "@sermo/core/contracts";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import type { StaffFormState } from "@/components/staff/form-rows";
import { call } from "@/lib/sermo/client";
import { parseId } from "@/lib/sermo/ids";
import {
  formFailure,
  type OrderChange,
  saveInOrder,
  text,
  whole,
} from "../../groups/form-errors";

const FIELDS = ["title", "description"];
const PATH = "/admin/awards";

// A new category (no id), which the backend puts after the last one, or a change of one. The order
// is changed on the sort page.
export async function saveAwardCategory(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.awardCategories.errors");
  const raw = text(formData, "id");
  const categoryId = raw === "" ? null : parseId(raw);
  if (raw !== "" && categoryId === null) return { error: t("id") };
  const fields = {
    title: text(formData, "title"),
    description: text(formData, "description"),
  };
  try {
    if (categoryId === null) await call(awardCategoriesCreate, fields);
    else await call(awardCategoriesUpdate, { categoryId, ...fields });
  } catch (error) {
    return formFailure(error, FIELDS);
  }
  redirect(
    `${PATH}?notice=${categoryId === null ? "categoryCreated" : "categorySaved"}`,
  );
}

// "Save order": the categories whose number was changed from what the page showed
// (`before:<id>`), each saved on its own.
export async function saveAwardCategoryOrder(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.awardCategories.errors");
  const changes: OrderChange[] = [];
  for (const [name] of formData) {
    if (!name.startsWith("position:")) continue;
    const categoryId = parseId(name.slice("position:".length));
    const position = whole(text(formData, name));
    if (categoryId === null || position === null) return { error: t("order") };
    if (position !== whole(text(formData, `before:${categoryId}`))) {
      changes.push({
        title: text(formData, `title:${categoryId}`) || `#${categoryId}`,
        save: () => call(awardCategoriesUpdate, { categoryId, position }),
      });
    }
  }
  const { state } = await saveInOrder(changes);
  if (state) return state;
  redirect(`${PATH}?notice=categoryOrdered`);
}

// Delete a category; its awards stay, without a category.
export async function deleteAwardCategory(
  _previous: StaffFormState,
  formData: FormData,
): Promise<StaffFormState> {
  const t = await getTranslations("adminEconomy.awardCategories.errors");
  const categoryId = parseId(text(formData, "id"));
  if (categoryId === null) return { error: t("id") };
  try {
    await call(awardCategoriesDelete, { categoryId });
  } catch (error) {
    return formFailure(error, []);
  }
  redirect(`${PATH}?notice=categoryDeleted`);
}
