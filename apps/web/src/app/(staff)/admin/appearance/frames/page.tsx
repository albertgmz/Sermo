import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CatalogPage } from "../screens";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAppearance.catalog");
  return { title: t("frames.metaTitle") };
}

export default function Page({
  searchParams,
}: PageProps<"/admin/appearance/frames">) {
  return <CatalogPage kind="frame" searchParams={searchParams} />;
}
