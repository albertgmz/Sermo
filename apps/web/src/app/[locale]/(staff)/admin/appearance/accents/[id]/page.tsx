import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PaletteEditPage } from "../../screens";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAppearance.palette");
  return { title: t("accents.editHeading") };
}

export default function Page({
  params,
}: PageProps<"/[locale]/admin/appearance/accents/[id]">) {
  return <PaletteEditPage kind="accent" params={params} />;
}
