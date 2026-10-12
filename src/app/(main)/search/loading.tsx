import {
  CardSkeleton,
  FormRowSkeleton,
  LoadingRegion,
  MemberListSkeleton,
  TextSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion label="Loading search…">
      <PageLayout mainClassName="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Search</h1>
        <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <FormRowSkeleton />
          </div>
          <FormRowSkeleton />
          <FormRowSkeleton />
          <FormRowSkeleton />
          <div className="flex justify-between sm:col-span-3">
            <Skeleton className="h-10 w-40 md:h-8" />
            <Skeleton className="h-10 w-24 md:h-8" />
          </div>
        </div>
        <CardSkeleton>
          <div className="p-4">
            <TextSkeleton />
          </div>
          <div className="p-4">
            <TextSkeleton />
          </div>
        </CardSkeleton>
        <MemberListSkeleton rows={3} />
      </PageLayout>
    </LoadingRegion>
  );
}
