import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// The messages of a conversation while they load: bubbles on either side.
export function MessagesSkeleton() {
  return (
    <div className="flex-1 space-y-4 px-3 py-4 lg:overflow-y-auto lg:px-4">
      {["w-3/5", "w-2/5", "w-1/2"].map((width, index) => (
        <div
          key={width}
          className={cn(
            "flex items-end gap-2",
            index === 1 && "flex-row-reverse",
          )}
        >
          {index !== 1 && <Skeleton className="size-8 shrink-0 rounded-full" />}
          <Skeleton className={cn("h-14 rounded-xl", width)} />
        </div>
      ))}
    </div>
  );
}
