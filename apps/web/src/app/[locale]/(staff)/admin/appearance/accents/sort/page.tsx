import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PaletteSortPage } from "../../screens";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminAppearance.palette");
  return { title: t("accents.sortHeading") };
}

export default function Page() {
  return <PaletteSortPage kind="accent" />;
}
