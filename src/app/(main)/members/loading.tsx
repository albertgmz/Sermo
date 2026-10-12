import {
  LoadingRegion,
  MembersOverviewSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion label="Loading members…">
      <PageLayout
        aside={
          <div className="space-y-1">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        }
        asideSide="start"
        asideOnMobile="hidden"
        mainClassName="space-y-(--page-gap)"
      >
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Members</h1>
          <Skeleton className="mt-1 h-5 w-3/4" />
        </header>
        <div className="lg:hidden">
          <TabsSkeleton />
        </div>
        <MembersOverviewSkeleton />
      </PageLayout>
    </LoadingRegion>
  );
}
