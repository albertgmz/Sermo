import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PaletteEditPage } from "../../screens";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAppearance.palette");
  return { title: t("prefixColors.editHeading") };
}

export default function Page({
  params,
}: PageProps<"/[locale]/admin/appearance/prefix-colors/[id]">) {
  return <PaletteEditPage kind="prefix" params={params} />;
}
