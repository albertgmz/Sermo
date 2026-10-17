import { Skeleton } from "@/components/ui/skeleton";

// The member's header before it settles: the trail, the card, then the tab strip.
export function HeaderSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4">
      <Skeleton className="h-10 w-40 md:h-8" />
      <div className="flex items-center gap-4">
        <Skeleton className="size-10 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
      <Skeleton className="h-11 w-full" />
    </div>
  );
}
