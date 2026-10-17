import { ScreenFrame } from "@/components/staff/screen-frame";
import { QueueSkeleton } from "../../moderation/skeletons";
import { staffTrail } from "../../trail";

// The frame of a log page: the header with its breadcrumb at once, the log streaming in below it.
// `path` is the page's own address, for the breadcrumb.
export function LogShell({
  path,
  heading,
  subtitle,
  loading,
  children,
}: {
  path: string;
  heading: string;
  subtitle: string;
  loading: string;
  children: React.ReactNode;
}) {
  return (
    <ScreenFrame
      trail={staffTrail(path)}
      heading={heading}
      subtitle={subtitle}
      label={loading}
      fallback={<QueueSkeleton />}
    >
      {children}
    </ScreenFrame>
  );
}
