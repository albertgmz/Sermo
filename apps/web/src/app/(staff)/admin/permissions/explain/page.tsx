import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { ListSkeleton, PageHead } from "../../groups/skeletons";
import { Explain } from "./explain";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.explain");
  return { title: t("metaTitle") };
}

export default function ExplainPage({
  searchParams,
}: PageProps<"/admin/permissions/explain">) {
  const t = useTranslations("adminGroups.explain");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <ListSkeleton rows={3} />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <Explain searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
