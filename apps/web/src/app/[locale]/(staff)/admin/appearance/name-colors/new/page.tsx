import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PaletteEditPage } from "../../screens";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAppearance.palette");
  return { title: t("nameColors.newHeading") };
}

export default function Page() {
  return <PaletteEditPage kind="name" />;
}
