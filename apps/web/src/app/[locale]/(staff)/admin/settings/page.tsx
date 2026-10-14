import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { GeneralForm } from "./general-form";
import { SettingsScreen } from "./settings-screen";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.pages.general");
  return { title: t("metaTitle") };
}

export default function GeneralPage({
  searchParams,
}: PageProps<"/[locale]/admin/settings">) {
  return (
    <SettingsScreen screen="general" searchParams={searchParams}>
      <GeneralForm />
    </SettingsScreen>
  );
}
