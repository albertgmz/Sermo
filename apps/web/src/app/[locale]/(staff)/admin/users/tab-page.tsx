import { StreamedPanel } from "@/components/staff/screen-frame";
import { FormSkeleton } from "../../skeletons";

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
    <StreamedPanel label={label} fallback={<FormSkeleton rows={rows} />}>
      {children}
    </StreamedPanel>
  );
}
