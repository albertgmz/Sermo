import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { GroupList } from "./group-list";
import { FormSkeleton, ListSkeleton, PageHead } from "./skeletons";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.list");
  return { title: t("metaTitle") };
}

export default function GroupsPage({
  searchParams,
}: PageProps<"/admin/groups">) {
  const t = useTranslations("adminGroups.list");
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
          <GroupList searchParams={searchParams} />
        </div>
      </Suspense>
    </div>
  );
}
