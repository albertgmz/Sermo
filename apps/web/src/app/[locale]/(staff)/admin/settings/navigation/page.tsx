import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AddLink, SortLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
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
          <SortLink href="/admin/settings/navigation/sort">
            {list("sort")}
          </SortLink>
          <AddLink href="/admin/settings/navigation/new">{list("add")}</AddLink>
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
