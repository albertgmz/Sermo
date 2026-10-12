import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { ContentSkeleton } from "../../moderation/skeletons";
import { PageHead } from "../groups/skeletons";
import { Maintenance } from "./maintenance";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminTools.maintenance");
  return { title: t("metaTitle") };
}

export default function ToolsPage({ searchParams }: PageProps<"/admin/tools">) {
  const t = useTranslations("adminTools.maintenance");
  return (
    <div className="space-y-6">
      <PageHead heading={t("heading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <div className="space-y-4">
              <ContentSkeleton />
              <ContentSkeleton />
            </div>
          </LoadingRegion>
        }
      >
        <Maintenance searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
