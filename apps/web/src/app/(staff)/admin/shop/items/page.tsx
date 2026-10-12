import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { EconomyFrame } from "../../credits/shared";
import { ItemScreen } from "./item-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.items");
  return { title: t("metaTitle") };
}

export default function ShopItemsPage({
  searchParams,
}: PageProps<"/admin/shop/items">) {
  const t = useTranslations("adminEconomy.items");
  return (
    <EconomyFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      loading={t("loading")}
    >
      <ItemScreen searchParams={searchParams} />
    </EconomyFrame>
  );
}
