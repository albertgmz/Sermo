import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PalettePage } from "../screens";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAppearance.palette");
  return { title: t("prefixColors.metaTitle") };
}

export default function Page({
  searchParams,
}: PageProps<"/admin/appearance/prefix-colors">) {
  return <PalettePage kind="prefix" searchParams={searchParams} />;
}
