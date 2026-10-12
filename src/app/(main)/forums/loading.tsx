import {
  ForumCategoriesSkeleton,
  ForumStatsSkeleton,
  LoadingRegion,
  SidebarSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";

export default function Loading() {
  return (
    <LoadingRegion label="Loading forums…">
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
