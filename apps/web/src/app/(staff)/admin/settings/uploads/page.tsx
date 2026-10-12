import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "../settings-screen";
import { UploadsForm } from "./uploads-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.pages.uploads");
  return { title: t("metaTitle") };
}

export default function UploadsPage({
  searchParams,
}: PageProps<"/admin/settings/uploads">) {
  return (
    <SettingsScreen screen="uploads" searchParams={searchParams}>
      <UploadsForm />
    </SettingsScreen>
  );
}
