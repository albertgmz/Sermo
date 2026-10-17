import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AddLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ListSkeleton } from "../../skeletons";
import { staffTrail } from "../../trail";
import { AnnouncementList } from "./announcement-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCommunication.announcements");
  return { title: t("metaTitle") };
}

export default function AnnouncementsPage({
  searchParams,
}: PageProps<"/[locale]/admin/announcements">) {
  const t = useTranslations("adminCommunication.announcements");
  const add = <AddLink href="/admin/announcements/new">{t("new")}</AddLink>;
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/announcements")}
      actions={add}
      label={t("loading")}
      fallback={<ListSkeleton rows={5} />}
    >
      <AnnouncementList searchParams={searchParams} addAction={add} />
    </ScreenFrame>
  );
}
