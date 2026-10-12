import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { FormSkeleton } from "../groups/skeletons";

// The frame of a tab's content: it streams in below the member's header with a form-shaped
// skeleton, and its panels are spaced as on every screen of the panel.
export function TabPage({
  label,
  children,
  rows = 5,
}: {
  label: string;
  children: React.ReactNode;
  rows?: number;
}) {
  return (
    <Suspense
      fallback={
        <LoadingRegion label={label}>
          <FormSkeleton rows={rows} />
        </LoadingRegion>
      }
    >
      <div className="space-y-4">{children}</div>
    </Suspense>
  );
}
