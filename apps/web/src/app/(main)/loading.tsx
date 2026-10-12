import { useTranslations } from "next-intl";
import {
  FeedSkeleton,
  LoadingRegion,
  SidebarSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";

export default function Loading() {
  const t = useTranslations("home.loading");
  return (
    <LoadingRegion label={t("feed")}>
      <PageLayout
        aside={<SidebarSkeleton />}
        asideOnMobile="hidden"
        mainClassName="space-y-(--page-gap)"
      >
        <TabsSkeleton />
        <FeedSkeleton />
      </PageLayout>
    </LoadingRegion>
  );
}
