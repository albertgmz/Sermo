import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../../../trail";
import { ListSkeleton } from "../../../groups/skeletons";
import { CategoryOrder } from "../category-order";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.categories.sort");
  return { title: t("metaTitle") };
}

export default function SortCategoriesPage() {
  const t = useTranslations("adminEconomy.categories");
  return (
    <ScreenFrame
      heading={t("sort.heading")}
      subtitle={t("sort.description")}
      trail={staffTrail("/admin/shop/categories/sort")}
      label={t("loading")}
      fallback={<ListSkeleton rows={6} />}
    >
      <CategoryOrder />
    </ScreenFrame>
  );
}
