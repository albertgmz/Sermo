import { TextSkeleton } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

// The messages of a conversation while they load.
export function MessagesSkeleton() {
  return (
    <div className="flex-1 space-y-4 px-4 py-4 lg:overflow-y-auto">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="h-4 w-32" />
            <TextSkeleton />
          </div>
        </div>
      ))}
    </div>
  );
}
