import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "../settings-screen";
import { SeoForm } from "./seo-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.pages.seo");
  return { title: t("metaTitle") };
}

export default function SeoPage({
  searchParams,
}: PageProps<"/[locale]/admin/settings/seo">) {
  return (
    <SettingsScreen screen="seo" searchParams={searchParams}>
      <SeoForm />
    </SettingsScreen>
  );
}
