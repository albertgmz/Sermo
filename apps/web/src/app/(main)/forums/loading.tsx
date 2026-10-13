import { getTranslations } from "next-intl/server";
import {
  ForumCategoriesSkeleton,
  ForumStatsSkeleton,
  LoadingRegion,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { getSite } from "@/lib/sermo/site";

export default async function Loading() {
  const [t, { forumStatsEnabled }] = await Promise.all([
    getTranslations("forums.loading"),
    getSite(),
  ]);
  return (
    <LoadingRegion label={t("aria.forums")}>
      <PageLayout mainClassName="space-y-(--page-gap)">
        {forumStatsEnabled && <ForumStatsSkeleton />}
        <TabsSkeleton />
        <ForumCategoriesSkeleton />
      </PageLayout>
    </LoadingRegion>
  );
}
