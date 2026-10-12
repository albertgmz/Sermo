import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "../settings-screen";
import { LevelsForm } from "./levels-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.pages.levels");
  return { title: t("metaTitle") };
}

export default function LevelsPage({
  searchParams,
}: PageProps<"/admin/settings/levels">) {
  return (
    <SettingsScreen screen="levels" searchParams={searchParams}>
      <LevelsForm />
    </SettingsScreen>
  );
}
