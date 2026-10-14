import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListFormSkeleton } from "../../groups/skeletons";
import { ItemScreen } from "./item-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminEconomy.items");
  return { title: t("metaTitle") };
}

export default function ShopItemsPage({
  searchParams,
}: PageProps<"/[locale]/admin/shop/items">) {
  const t = useTranslations("adminEconomy.items");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<ListFormSkeleton />}
    >
      <ItemScreen searchParams={searchParams} />
    </ScreenFrame>
  );
}
