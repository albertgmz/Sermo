import {
  LoadingRegion,
  MemberCardSkeleton,
  TextSkeleton,
} from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <LoadingRegion label="Loading appearance settings…">
      <section className="rounded-lg border bg-card">
        <div className="border-b p-4">
          <h1 className="text-xl font-bold tracking-tight">Appearance</h1>
          <p className="text-xs text-muted-foreground">
            How the forum looks for you, and how you look to everyone else.
          </p>
        </div>
        <div className="grid gap-6 p-4 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
          <div className="min-w-0 xl:col-start-2 xl:row-start-1">
            <Skeleton className="mb-2 h-4 w-20" />
            <MemberCardSkeleton />
            <Skeleton className="mt-2 h-8 w-full" />
          </div>
          <div className="min-w-0 space-y-6 xl:col-start-1 xl:row-start-1">
            <div className="space-y-3">
              <TextSkeleton />
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {[1, 2, 3, 4, 5, 6].map((accent) => (
                  <Skeleton key={accent} className="h-16 w-full" />
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <TextSkeleton />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
                {[1, 2, 3, 4].map((frame) => (
                  <Skeleton key={frame} className="aspect-square" />
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <TextSkeleton />
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-10 w-32" />
                <Skeleton className="h-10 w-32" />
              </div>
            </div>
            <div className="space-y-3">
              <TextSkeleton />
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                {[1, 2, 3, 4, 5, 6].map((cover) => (
                  <div key={cover}>
                    <Skeleton className="aspect-[5/2] w-full" />
                    <Skeleton className="mt-2 h-6 w-full" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </LoadingRegion>
  );
}
