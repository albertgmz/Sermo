import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CatalogEditPage } from "../../screens";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAppearance.catalog");
  return { title: t("covers.newHeading") };
}

export default function Page() {
  return <CatalogEditPage kind="profile_cover" />;
}
