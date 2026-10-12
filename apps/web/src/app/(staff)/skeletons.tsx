import {
  CardSkeleton,
  MemberRowSkeleton,
  StatTileSkeleton,
} from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

// The skeletons of the panel's pages; each mirrors the block it stands for once settled.

export function HeadingSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-2">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72 max-w-full" />
    </div>
  );
}

export function PendingSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-3">
      <Skeleton className="h-4 w-28" />
      <div className="grid gap-3 sm:grid-cols-2">
        <StatTileSkeleton />
        <StatTileSkeleton />
      </div>
    </div>
  );
}

export function SectionGridSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-3">
      <Skeleton className="h-4 w-20" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((card) => (
          <div key={card} className="rounded-lg border bg-card p-4">
            <Skeleton className="h-4 w-28" />
            <div className="mt-3 space-y-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-5 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ActivitySkeleton() {
  return (
    <CardSkeleton described>
      {[1, 2, 3].map((row) => (
        <div key={row} className="space-y-2 px-4 py-3">
          <Skeleton className="h-4 w-1/3" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        </div>
      ))}
    </CardSkeleton>
  );
}

export function StaffSkeleton() {
  return (
    <CardSkeleton described>
      {[1, 2, 3].map((row) => (
        <MemberRowSkeleton key={row} />
      ))}
    </CardSkeleton>
  );
}

export function JobsSkeleton() {
  return (
    <CardSkeleton described>
      <div className="grid grid-cols-3 gap-2 px-4 py-3">
        {[1, 2, 3].map((cell) => (
          <Skeleton key={cell} className="h-10 w-full" />
        ))}
      </div>
      <div className="space-y-2 px-4 py-3">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </CardSkeleton>
  );
}
