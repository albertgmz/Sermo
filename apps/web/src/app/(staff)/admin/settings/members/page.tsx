import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "../settings-screen";
import { MembersForm } from "./members-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.pages.members");
  return { title: t("metaTitle") };
}

export default function MembersPage({
  searchParams,
}: PageProps<"/admin/settings/members">) {
  return (
    <SettingsScreen screen="members" searchParams={searchParams}>
      <MembersForm />
    </SettingsScreen>
  );
}
