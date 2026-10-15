import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "../settings-screen";
import { WarningActions } from "./warning-actions";
import { WarningTypes } from "./warning-types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.pages.warnings");
  return { title: t("metaTitle") };
}

export default function WarningsPage({
  searchParams,
}: PageProps<"/[locale]/admin/settings/warnings">) {
  return (
    <SettingsScreen screen="warnings" searchParams={searchParams}>
      <WarningTypes />
      <WarningActions />
    </SettingsScreen>
  );
}
