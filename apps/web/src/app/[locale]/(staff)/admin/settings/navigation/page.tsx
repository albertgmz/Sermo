import { ArrowUpDown, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { staffTrail } from "../../../trail";
import { ListSkeleton } from "../../groups/skeletons";
import { SettingsNotice } from "../settings-screen";
import { EntryList } from "./entry-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminSetup.pages.navigation");
  return { title: t("metaTitle") };
}

export default function NavigationPage({
  searchParams,
}: PageProps<"/[locale]/admin/settings/navigation">) {
  const t = useTranslations("adminSetup.pages.navigation");
  const list = useTranslations("adminSetup.navigation.list");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/settings/navigation")}
      heading={t("heading")}
      subtitle={t("subtitle")}
      actions={
        <>
          <Link
            href="/admin/settings/navigation/sort"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "min-h-10 px-4",
            )}
          >
            <ArrowUpDown aria-hidden="true" />
            {list("sort")}
          </Link>
          <Link
            href="/admin/settings/navigation/new"
            className={cn(buttonVariants(), "min-h-10 px-4")}
          >
            <Plus aria-hidden="true" />
            {list("add")}
          </Link>
        </>
      }
      label={t("loading")}
      fallback={<ListSkeleton rows={8} />}
    >
      <SettingsNotice searchParams={searchParams} />
      <EntryList />
    </ScreenFrame>
  );
}
