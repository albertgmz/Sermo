import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { GroupList } from "./group-list";
import { ListFormSkeleton } from "./skeletons";

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
      label={t("loading")}
      fallback={<ListFormSkeleton />}
    >
      <GroupList searchParams={searchParams} />
    </ScreenFrame>
  );
}
