import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CatalogSortPage } from "../../screens";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAppearance.catalog");
  return { title: t("covers.sortHeading") };
}

export default function Page() {
  return <CatalogSortPage kind="profile_cover" />;
}
