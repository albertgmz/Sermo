import { LoadingRegion, MemberRowSkeleton } from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion label="Loading notifications…">
      <PageLayout>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Notifications
            </h1>
            <Skeleton className="h-5 w-32" />
          </div>
          <Skeleton className="h-10 w-36 md:h-8" />
        </div>
        <div className="mt-4 divide-y overflow-hidden rounded-lg border bg-card">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <MemberRowSkeleton key={i} />
          ))}
        </div>
      </PageLayout>
    </LoadingRegion>
  );
}
