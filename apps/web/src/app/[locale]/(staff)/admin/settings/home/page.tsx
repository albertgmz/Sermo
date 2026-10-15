import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "../settings-screen";
import { HomeForm } from "./home-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.pages.home");
  return { title: t("metaTitle") };
}

export default function HomePage({
  searchParams,
}: PageProps<"/[locale]/admin/settings/home">) {
  return (
    <SettingsScreen screen="home" searchParams={searchParams}>
      <HomeForm />
    </SettingsScreen>
  );
}
