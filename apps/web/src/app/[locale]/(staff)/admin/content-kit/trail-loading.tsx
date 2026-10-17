import { LoadingRegion } from "@/components/forum/skeletons";
import { HeadingSkeleton } from "../../skeletons";

// The loading file of a page of the content and communication screens: the heading placeholder
// with the row of the breadcrumb, then the skeleton of what settles.
export function TrailLoading({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <LoadingRegion label={label}>
      <div className="space-y-6">
        <HeadingSkeleton trail />
        <div className="space-y-4">{children}</div>
      </div>
    </LoadingRegion>
  );
}
