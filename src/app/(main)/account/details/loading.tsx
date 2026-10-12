import { LoadingRegion, TextSkeleton } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion label="Loading account details…">
      <section className="rounded-lg border bg-card">
        <div className="border-b p-4">
          <h1 className="text-xl font-bold tracking-tight">Account details</h1>
          <p className="text-xs text-muted-foreground">
            The name and title shown on your profile and posts.
          </p>
        </div>
        <div className="divide-y">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="grid gap-3 p-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6"
            >
              <Skeleton className="h-4 w-24" />
              <div className="space-y-2">
                <Skeleton className="h-10 w-full md:h-8" />
                <TextSkeleton />
              </div>
            </div>
          ))}
        </div>
        <div className="border-t p-4">
          <Skeleton className="h-10 w-28" />
        </div>
      </section>
    </LoadingRegion>
  );
}
