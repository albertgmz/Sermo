import { LoadingRegion } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

// The rows of a list in a header panel or the avatar menu while they are being asked for.
export function PanelSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label}>
      <ul aria-hidden="true" className="divide-y divide-border">
        {[1, 2, 3].map((row) => (
          <li key={row} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </li>
        ))}
      </ul>
    </LoadingRegion>
  );
}
