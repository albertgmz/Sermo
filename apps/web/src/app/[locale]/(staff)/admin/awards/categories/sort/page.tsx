import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListSkeleton } from "../../../../skeletons";
import { staffTrail } from "../../../../trail";
import { AwardCategoryOrder } from "../category-order";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.awardCategories.sort");
  return { title: t("metaTitle") };
}

export default function SortAwardCategoriesPage() {
  const t = useTranslations("adminEconomy.awardCategories");
  return (
    <ScreenFrame
      heading={t("sort.heading")}
      subtitle={t("sort.description")}
      trail={staffTrail("/admin/awards/categories/sort")}
      label={t("loading")}
      fallback={<ListSkeleton rows={6} />}
    >
      <AwardCategoryOrder />
    </ScreenFrame>
  );
}
