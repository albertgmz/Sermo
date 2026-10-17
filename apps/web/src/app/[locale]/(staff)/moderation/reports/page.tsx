import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Notice } from "@/components/staff/notice";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../trail";
import { QueueSkeleton } from "../skeletons";
import { ReportList } from "./report-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("moderation.reports");
  return { title: t("metaTitle") };
}

export default function ReportsPage({
  searchParams,
}: PageProps<"/[locale]/moderation/reports">) {
  const t = useTranslations("moderation.reports");
  return (
    <ScreenFrame
      trail={staffTrail("/moderation/reports")}
      heading={t("heading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={<QueueSkeleton />}
    >
      <Notice
        namespace="moderation.notices"
        searchParams={searchParams}
        shown={["stateSaved", "approved", "rejected"]}
      />
      <ReportList searchParams={searchParams} />
    </ScreenFrame>
  );
}
