import { TextSkeleton } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

// The messages of a conversation while they load: rows in one card, like the posts of a thread.
export function MessagesSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="divide-y divide-border overflow-hidden rounded-lg border bg-card"
    >
      {[1, 2, 3].map((item) => (
        <div key={item} className="flex gap-3 px-4 pt-4 pb-2">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <div className="flex h-5 items-center">
              <Skeleton className="h-3 w-40 max-w-full" />
            </div>
            <div className="mt-1 max-w-3xl">
              <TextSkeleton />
            </div>
            <div className="mt-1 flex h-10 items-center md:h-7">
              <Skeleton className="h-5 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
