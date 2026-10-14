import type { Metadata } from "next";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { ListSkeleton, PageHead } from "../../groups/skeletons";
import { ModeratorList } from "./moderator-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("adminGroups.moderators");
  return { title: t("metaTitle") };
}

export default function ModeratorsPage() {
  const t = useTranslations("adminGroups.moderators");
  return (
    <div className="space-y-6">
      <PageHead heading={t("pageHeading")} subtitle={t("subtitle")} />
      <Suspense
        fallback={
          <LoadingRegion label={t("loading")}>
            <ListSkeleton />
          </LoadingRegion>
        }
      >
        <ModeratorList />
      </Suspense>
    </div>
  );
}
