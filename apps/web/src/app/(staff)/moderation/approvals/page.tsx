import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { Notice } from "@/components/staff/notice";
import { PageHead } from "../../admin/groups/skeletons";
import { QueueSkeleton } from "../skeletons";
import { ApprovalList } from "./approval-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("moderation.approvals");
  return { title: t("metaTitle") };
}

export default function ApprovalsPage({
  searchParams,
}: PageProps<"/moderation/approvals">) {
  const t = useTranslations("moderation.approvals");
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
          <Notice
            namespace="moderation.notices"
            searchParams={searchParams}
            shown={["stateSaved", "approved", "rejected"]}
          />
          <ApprovalList searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
