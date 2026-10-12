import {
  CardSkeleton,
  LoadingRegion,
  MemberRowSkeleton,
} from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <LoadingRegion label="Loading security settings…">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight">Security</h1>
        <CardSkeleton>
          <MemberRowSkeleton />
          <MemberRowSkeleton />
        </CardSkeleton>
        <section className="rounded-lg border bg-card p-4">
          <h2 className="text-sm font-semibold">Log out</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            End your session in this browser.
          </p>
          <Skeleton className="mt-3 h-10 w-20" />
        </section>
      </div>
    </LoadingRegion>
  );
}
