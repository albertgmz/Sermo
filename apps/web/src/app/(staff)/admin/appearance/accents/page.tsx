import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PalettePage } from "../screens";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAppearance.palette");
  return { title: t("accents.metaTitle") };
}

export default function Page({
  searchParams,
}: PageProps<"/admin/appearance/accents">) {
  return <PalettePage kind="accent" searchParams={searchParams} />;
}
