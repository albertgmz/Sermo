import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { QueueSkeleton } from "../../moderation/skeletons";
import { PageHead } from "../groups/skeletons";

// The frame of a log page: the heading at once, the log streaming in below it.
export function LogShell({
  heading,
  subtitle,
  loading,
  children,
}: {
  heading: string;
  subtitle: string;
  loading: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHead heading={heading} subtitle={subtitle} />
      <Suspense
        fallback={
          <LoadingRegion label={loading}>
            <QueueSkeleton />
          </LoadingRegion>
        }
      >
        <div className="space-y-4">{children}</div>
      </Suspense>
    </div>
  );
}
