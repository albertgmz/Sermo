import {
  CardSkeleton,
  FormRowSkeleton,
  LoadingRegion,
} from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion label="Loading forum settings…">
      <div className="flex gap-2">
        <Skeleton className="h-10 w-28" />
        <Skeleton className="h-10 w-24" />
      </div>
      <CardSkeleton>
        <div className="space-y-5 p-4">
          <FormRowSkeleton />
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-24 w-full" />
          </div>
          <FormRowSkeleton />
          <Skeleton className="h-8 w-full" />
          <div className="space-y-2 rounded-md border bg-muted/50 p-3">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-5 w-28" />
          </div>
          <Skeleton className="h-10 w-28" />
        </div>
      </CardSkeleton>
    </LoadingRegion>
  );
}
