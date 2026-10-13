import { ScreenFrame } from "@/components/staff/screen-frame";
import { QueueSkeleton } from "../../moderation/skeletons";

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
    <ScreenFrame
      heading={heading}
      subtitle={subtitle}
      label={loading}
      fallback={<QueueSkeleton />}
    >
      {children}
    </ScreenFrame>
  );
}
