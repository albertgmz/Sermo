import { StaticPage } from "@/app/(main)/(static)/static-page";
import { LoadingRegion, TextSkeleton } from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <StaticPage
      href="/legal"
      title="Legal notice"
      updated="September 1, 2026"
      content=""
    >
      <LoadingRegion label="Loading legal notice…">
        <div className="mt-6 space-y-6">
          <TextSkeleton />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-6 w-40" />
              <TextSkeleton />
            </div>
          ))}
        </div>
      </LoadingRegion>
    </StaticPage>
  );
}
