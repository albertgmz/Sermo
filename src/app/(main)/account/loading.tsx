import {
  LoadingRegion,
  MemberListSkeleton,
  StatTileSkeleton,
} from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion label="Loading your account overview…">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 lg:pb-2">
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <Skeleton className="h-9 w-48" />
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <StatTileSkeleton key={i} />
          ))}
        </div>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          <div className="rounded-lg border bg-card p-4">
            <Skeleton className="mb-4 h-5 w-40" />
            <Skeleton className="h-64 w-full" />
          </div>
          <MemberListSkeleton rows={6} />
        </div>
      </div>
    </LoadingRegion>
  );
}
