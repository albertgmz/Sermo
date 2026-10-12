import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { FormSkeleton, ListSkeleton, PageHead } from "../groups/skeletons";
import { FilterList } from "./filter-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.wordFilters");
  return { title: t("metaTitle") };
}

export default function WordFiltersPage({
  searchParams,
}: PageProps<"/admin/word-filters">) {
  const t = useTranslations("adminContent.wordFilters");
  return (
    <div className="space-y-6">
      <PageHead heading={t("heading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <div className="space-y-4">
              <ListSkeleton />
              <FormSkeleton />
            </div>
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <FilterList searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
