import { LoadingRegion } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="hidden h-full items-center justify-center lg:flex">
      <LoadingRegion label="Loading conversations…">
        <div className="flex flex-col items-center gap-3 px-4">
          <Skeleton className="size-10" />
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
      </LoadingRegion>
    </div>
  );
}
