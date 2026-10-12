import {
  CardSkeleton,
  FormRowSkeleton,
  LoadingRegion,
} from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion label="Loading general settings…">
      <CardSkeleton>
        <div className="space-y-5 p-4">
          <FormRowSkeleton />
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-24 w-full" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-4 w-full" />
          </div>
          <Skeleton className="h-10 w-28" />
        </div>
      </CardSkeleton>
    </LoadingRegion>
  );
}
