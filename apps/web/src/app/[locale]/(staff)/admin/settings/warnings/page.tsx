import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AddLink } from "@/components/staff/page-header";
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
  const types = useTranslations("adminSetup.warningTypes");
  const actions = useTranslations("adminSetup.warningActions");
  return (
    <SettingsScreen
      screen="warnings"
      searchParams={searchParams}
      actions={
        <>
          <AddLink href="/admin/settings/warnings/types/new">
            {types("add")}
          </AddLink>
          <AddLink href="/admin/settings/warnings/actions/new" secondary>
            {actions("add")}
          </AddLink>
        </>
      }
    >
      <WarningTypes />
      <WarningActions />
    </SettingsScreen>
  );
}
