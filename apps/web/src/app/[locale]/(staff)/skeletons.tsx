import {
  CardSkeleton,
  MemberRowSkeleton,
  StatTileSkeleton,
} from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

// The skeletons of the panel's pages; each mirrors the block it stands for once settled.

// `trail`: the page draws a `PageHeader` with a trail, whose row comes first.
export function HeadingSkeleton({ trail }: { trail?: boolean }) {
  return (
    <div aria-hidden="true" className="space-y-2">
      {trail && <Skeleton className="h-10 w-40 md:h-8" />}
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

// A card of `LinkCard`: the icon box, the title and the line, and on the home the screens' links.
function LinkCardSkeleton({ links }: { links?: boolean }) {
  return (
    <div className="flex gap-3 rounded-lg border bg-card p-4">
      <Skeleton className="size-10 shrink-0 rounded-md" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-3/4" />
        {links && (
          <div className="space-y-2 pt-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        )}
      </div>
    </div>
  );
}

export function LinkCardsSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
    >
      {[1, 2, 3, 4].map((card) => (
        <LinkCardSkeleton key={card} />
      ))}
    </div>
  );
}

export function SectionGridSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-3">
      <Skeleton className="h-4 w-20" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((card) => (
          <LinkCardSkeleton key={card} links />
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
