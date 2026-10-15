import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "../settings-screen";
import { AntispamForm } from "./antispam-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.pages.antispam");
  return { title: t("metaTitle") };
}

export default function AntispamPage({
  searchParams,
}: PageProps<"/[locale]/admin/settings/antispam">) {
  return (
    <SettingsScreen screen="antispam" searchParams={searchParams}>
      <AntispamForm />
    </SettingsScreen>
  );
}
