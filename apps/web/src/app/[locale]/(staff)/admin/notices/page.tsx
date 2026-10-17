import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { AddLink } from "@/components/staff/page-header";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../trail";
import { ListSkeleton } from "../groups/skeletons";
import { NoticeList } from "./notice-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminCommunication.notices");
  return { title: t("metaTitle") };
}

export default function NoticesPage({
  searchParams,
}: PageProps<"/[locale]/admin/notices">) {
  const t = useTranslations("adminCommunication.notices");
  const add = <AddLink href="/admin/notices/new">{t("header.add")}</AddLink>;
  return (
    <ScreenFrame
      heading={t("pageHeading")}
      subtitle={t("subtitle")}
      trail={staffTrail("/admin/notices")}
      actions={add}
      label={t("loading")}
      fallback={<ListSkeleton rows={5} />}
    >
      <NoticeList searchParams={searchParams} addAction={add} />
    </ScreenFrame>
  );
}
