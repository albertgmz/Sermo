import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CatalogEditPage } from "../../screens";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAppearance.catalog");
  return { title: t("covers.editHeading") };
}

export default function Page({
  params,
}: PageProps<"/[locale]/admin/appearance/covers/[id]">) {
  return <CatalogEditPage kind="profile_cover" params={params} />;
}
