import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "../settings-screen";
import { CookiesForm } from "./cookies-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.pages.cookies");
  return { title: t("metaTitle") };
}

export default function CookiesPage({
  searchParams,
}: PageProps<"/[locale]/admin/settings/cookies">) {
  return (
    <SettingsScreen screen="cookies" searchParams={searchParams}>
      <CookiesForm />
    </SettingsScreen>
  );
}
