import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Notice } from "@/components/staff/notice";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { staffTrail } from "../../trail";
import { QueueSkeleton } from "../skeletons";
import { ApprovalList } from "./approval-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("moderation.approvals");
  return { title: t("metaTitle") };
}

export default function ApprovalsPage({
  searchParams,
}: PageProps<"/[locale]/moderation/approvals">) {
  const t = useTranslations("moderation.approvals");
  return (
    <ScreenFrame
      trail={staffTrail("/moderation/approvals")}
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
      <ApprovalList searchParams={searchParams} />
    </ScreenFrame>
  );
}
