import { awardCategoriesList } from "@sermo/core/contracts";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/forum/empty-state";
import { SortForm } from "@/components/staff/sort-form";
import { read } from "@/lib/sermo/client";
import { saveAwardCategoryOrder } from "./actions";

// Every award category in the order the awards page shows them, written through the order action,
// which saves only the categories whose number changed (`before:<id>` is what the page showed).
export async function AwardCategoryOrder() {
  const [t, { items }] = await Promise.all([
    getTranslations("adminEconomy.awardCategories"),
    read(awardCategoriesList, {}),
  ]);
  if (items.length === 0)
    return (
      <div className="rounded-lg border bg-card">
        <EmptyState title={t("none")} description={t("emptyDescription")} />
      </div>
    );
  return (
    <SortForm
      action={saveAwardCategoryOrder}
      name="position:{id}"
      heading={t("sort.list")}
      items={items.map((category) => ({
        id: category.id,
        title: category.title,
        position: category.position,
        description: t("count", { count: category.awardCount }),
        fields: {
          [`before:${category.id}`]: category.position,
          [`title:${category.id}`]: category.title,
        },
      }))}
    />
  );
}
