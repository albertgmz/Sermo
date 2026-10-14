import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PalettePage } from "../screens";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAppearance.palette");
  return { title: t("nameColors.metaTitle") };
}

export default function Page({
  searchParams,
}: PageProps<"/[locale]/admin/appearance/name-colors">) {
  return <PalettePage kind="name" searchParams={searchParams} />;
}
