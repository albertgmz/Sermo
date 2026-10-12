import {
  FeedSkeleton,
  LoadingRegion,
  SidebarSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";

export default function Loading() {
  return (
    <LoadingRegion label="Loading your feed…">
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
