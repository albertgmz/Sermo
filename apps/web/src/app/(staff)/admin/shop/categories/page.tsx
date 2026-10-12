import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EconomyFrame } from "../../credits/shared";
import { CategoryScreen } from "./category-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.categories");
  return { title: t("metaTitle") };
}

export default function ShopCategoriesPage({
  searchParams,
}: PageProps<"/admin/shop/categories">) {
  const t = useTranslations("adminEconomy.categories");
  return (
    <EconomyFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      loading={t("loading")}
    >
      <CategoryScreen searchParams={searchParams} />
    </EconomyFrame>
  );
}
