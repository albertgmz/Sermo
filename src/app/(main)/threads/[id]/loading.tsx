import {
  EditorSkeleton,
  HeadingSkeleton,
  LoadingRegion,
  PostSkeleton,
} from "@/components/forum/skeletons";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion label="Loading the thread…">
      <PageLayout className="pt-2">
        <HeadingSkeleton />
        <div className="mt-4 divide-y overflow-hidden rounded-lg border bg-card">
          <PostSkeleton />
          <PostSkeleton />
          <PostSkeleton />
        </div>
        <div className="mt-4">
          <EditorSkeleton />
          <div className="mt-3 flex items-center justify-between gap-2">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-12" />
          </div>
        </div>
      </PageLayout>
    </LoadingRegion>
  );
}
