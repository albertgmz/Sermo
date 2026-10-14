import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListFormSkeleton } from "../../groups/skeletons";
import { CategoryScreen } from "./category-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.categories");
  return { title: t("metaTitle") };
}

export default function ShopCategoriesPage({
  searchParams,
}: PageProps<"/[locale]/admin/shop/categories">) {
  const t = useTranslations("adminEconomy.categories");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListFormSkeleton />}
    >
      <CategoryScreen searchParams={searchParams} />
    </ScreenFrame>
  );
}
