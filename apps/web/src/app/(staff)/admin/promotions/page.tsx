import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { FormSkeleton, ListSkeleton, PageHead } from "../groups/skeletons";
import { PromotionList } from "./promotion-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.promotions");
  return { title: t("metaTitle") };
}

export default function PromotionsPage({
  searchParams,
}: PageProps<"/admin/promotions">) {
  const t = useTranslations("adminGroups.promotions");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <div className="space-y-4">
              <ListSkeleton />
              <FormSkeleton rows={4} />
            </div>
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <PromotionList searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
