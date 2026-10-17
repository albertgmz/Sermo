import { shopCategoriesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { SortForm } from "@/components/staff/sort-form";
import { read } from "@/lib/sermo/client";
import { saveCategoryOrder } from "./actions";

// Every category in the order members see them, written through the order action, which saves
// only the categories whose number changed (`before:<id>` is what the page showed).
export async function CategoryOrder() {
  const [t, { items }] = await Promise.all([
    getTranslations("adminEconomy.categories"),
    read(shopCategoriesList, {}),
  ]);
  if (items.length === 0)
    return (
      <div className="rounded-lg border bg-card">
        <EmptyState
          title={t("sort.emptyTitle")}
          description={t("sort.emptyDescription")}
        />
      </div>
    );
  return (
    <SortForm
      action={saveCategoryOrder}
      name="position:{id}"
      heading={t("sort.list")}
      items={items.map((category) => ({
        id: category.id,
        title: category.name,
        position: category.position,
        description: category.isActive ? undefined : t("inactive"),
        fields: {
          [`before:${category.id}`]: category.position,
          [`title:${category.id}`]: category.name,
        },
      }))}
    />
  );
}
