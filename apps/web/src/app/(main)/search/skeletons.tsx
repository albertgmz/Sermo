import {
  CardSkeleton,
  FormRowSkeleton,
  TextSkeleton,
} from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function FormSkeleton() {
  return (
    <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3">
      <div className="sm:col-span-3">
        <FormRowSkeleton />
      </div>
      <FormRowSkeleton />
      <FormRowSkeleton />
      <FormRowSkeleton />
      <div className="flex justify-between sm:col-span-3">
        <Skeleton className="h-10 w-40 md:h-8" />
        <Skeleton className="h-10 w-24 md:h-8" />
      </div>
    </div>
  );
}

export function ResultsSkeleton() {
  return (
    <CardSkeleton>
      <div className="p-4">
        <TextSkeleton />
      </div>
      <div className="p-4">
        <TextSkeleton />
      </div>
    </CardSkeleton>
  );
}
