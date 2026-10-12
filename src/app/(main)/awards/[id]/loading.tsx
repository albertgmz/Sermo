import {
  LoadingRegion,
  MemberListSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion label="Loading the award…">
      <PageLayout className="pt-2" mainClassName="space-y-4">
        <div className="flex h-10 items-center md:h-8">
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="flex flex-col items-center overflow-hidden rounded-lg border bg-card px-4 pb-8 md:items-start md:px-10 md:py-14">
          <Skeleton className="-mx-4 -mb-10 aspect-video self-stretch rounded-none md:hidden" />
          <Skeleton className="size-16 md:size-20" />
          <Skeleton className="mt-5 h-4 w-24" />
          <Skeleton className="mt-1 h-9 w-48 md:h-10" />
          <Skeleton className="mt-2 h-12 w-full max-w-md" />
          <div className="mt-6 flex gap-8">
            <Skeleton className="h-9 w-12" />
            <Skeleton className="h-9 w-16" />
          </div>
        </div>
        <MemberListSkeleton />
      </PageLayout>
    </LoadingRegion>
  );
}
