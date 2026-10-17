import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SettingsScreen } from "../settings-screen";
import { WarningActions } from "./warning-actions";
import { WarningTypes } from "./warning-types";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.pages.warnings");
  return { title: t("metaTitle") };
}

const add = cn(buttonVariants({ variant: "outline" }), "min-h-10 px-4");

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
          <Link href="/admin/settings/warnings/types/new" className={add}>
            <Plus aria-hidden="true" />
            {types("add")}
          </Link>
          <Link href="/admin/settings/warnings/actions/new" className={add}>
            <Plus aria-hidden="true" />
            {actions("add")}
          </Link>
        </>
      }
    >
      <WarningTypes />
      <WarningActions />
    </SettingsScreen>
  );
}
