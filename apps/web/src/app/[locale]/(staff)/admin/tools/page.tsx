import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { ScreenFrame } from "@/components/staff/screen-frame";
import { ContentSkeleton } from "../../moderation/skeletons";
import { staffTrail } from "../../trail";
import { Maintenance } from "./maintenance";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminTools.maintenance");
  return { title: t("metaTitle") };
}

export default function ToolsPage({
  searchParams,
}: PageProps<"/[locale]/admin/tools">) {
  const t = useTranslations("adminTools.maintenance");
  return (
    <ScreenFrame
      trail={staffTrail("/admin/tools")}
      heading={t("heading")}
      subtitle={t("subtitle")}
      label={t("loading")}
      fallback={
        <>
          <ContentSkeleton />
          <ContentSkeleton />
        </>
      }
    >
      <Maintenance searchParams={searchParams} />
    </ScreenFrame>
  );
}
