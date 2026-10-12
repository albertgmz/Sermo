import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { FormSkeleton, ListSkeleton, PageHead } from "../groups/skeletons";
import { ForumTree } from "./tree";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminForums.tree");
  return { title: t("metaTitle") };
}

export default function ForumsPage({
  searchParams,
}: PageProps<"/admin/forums">) {
  const t = useTranslations("adminForums.tree");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <div className="space-y-4">
              <ListSkeleton rows={6} />
              <FormSkeleton />
            </div>
          </LoadingRegion>
        }
      >
        <div className="space-y-4">
          <ForumTree searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
