import {
  HeadingSkeleton,
  LoadingRegion,
  TabsSkeleton,
  ThreadRowSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion label="Loading threads…">
      <PageLayout className="pt-2">
        <HeadingSkeleton />
        <Skeleton className="mt-1 h-5 w-3/4" />
        <TabsSkeleton />
        <div className="mt-1 divide-y overflow-hidden rounded-lg border bg-card">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <ThreadRowSkeleton key={i} />
          ))}
        </div>
      </PageLayout>
    </LoadingRegion>
  );
}
