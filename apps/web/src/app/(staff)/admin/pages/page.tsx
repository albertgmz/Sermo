import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { FormSkeleton, ListSkeleton, PageHead } from "../groups/skeletons";
import { PageList } from "./page-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminContent.pages");
  return { title: t("metaTitle") };
}

export default function PagesPage({ searchParams }: PageProps<"/admin/pages">) {
  const t = useTranslations("adminContent.pages");
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
          <PageList searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
