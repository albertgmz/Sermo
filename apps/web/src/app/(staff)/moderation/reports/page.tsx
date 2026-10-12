import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { PageHead } from "../../admin/groups/skeletons";
import { Notice } from "../notice";
import { QueueSkeleton } from "../skeletons";
import { ReportList } from "./report-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("moderation.reports");
  return { title: t("metaTitle") };
}

export default function ReportsPage({
  searchParams,
}: PageProps<"/moderation/reports">) {
  const t = useTranslations("moderation.reports");
  return (
    <div className="space-y-6">
      <PageHead heading={t("heading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <QueueSkeleton />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <Notice searchParams={searchParams} />
          <ReportList searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
