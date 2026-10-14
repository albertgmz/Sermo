import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CatalogPage } from "../screens";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAppearance.catalog");
  return { title: t("covers.metaTitle") };
}

export default function Page({
  searchParams,
}: PageProps<"/[locale]/admin/appearance/covers">) {
  return <CatalogPage kind="profile_cover" searchParams={searchParams} />;
}
