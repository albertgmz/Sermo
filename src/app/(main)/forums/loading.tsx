import { useTranslations } from "next-intl";
import {
  ForumCategoriesSkeleton,
  ForumStatsSkeleton,
  LoadingRegion,
  SidebarSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";

export default function Loading() {
  const t = useTranslations("forums.loading");
  return (
    <LoadingRegion label={t("aria.forums")}>
      <PageLayout
        aside={<SidebarSkeleton />}
        mainClassName="space-y-(--page-gap)"
      >
        <ForumStatsSkeleton />
        <TabsSkeleton />
        <ForumCategoriesSkeleton />
      </PageLayout>
    </LoadingRegion>
  );
}
