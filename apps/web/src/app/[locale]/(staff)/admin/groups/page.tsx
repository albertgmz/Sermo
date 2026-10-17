import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AddLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../trail";
import { GroupList } from "./group-list";
import { ListSkeleton } from "./skeletons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.list");
  return { title: t("metaTitle") };
}

export default function GroupsPage({
  searchParams,
}: PageProps<"/[locale]/admin/groups">) {
  const t = useTranslations("adminGroups.list");
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/groups")}
      actions={<AddLink href="/admin/groups/new">{t("new")}</AddLink>}
      label={t("loading")}
      fallback={<ListSkeleton />}
    >
      <GroupList searchParams={searchParams} />
    </ScreenFrame>
  );
}
