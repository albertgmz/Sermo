import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { FormSkeleton, ListSkeleton, PageHead } from "../../groups/skeletons";
import { PrefixList } from "./prefix-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminForums.prefixes");
  return { title: t("metaTitle") };
}

export default function PrefixesPage({
  searchParams,
}: PageProps<"/admin/forums/prefixes">) {
  const t = useTranslations("adminForums.prefixes");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
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
          <PrefixList searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
