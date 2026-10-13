import { Suspense } from "react";
import { PageHead } from "@/app/(staff)/admin/groups/skeletons";
import { LoadingRegion } from "@/components/forum/skeletons";

// StreamedPanel: the content of a screen streaming in behind a skeleton, its panels spaced as on
// every screen of the panel.
//
// Props
//   label     The loading label announced while the skeleton shows.
//   fallback  The skeleton, mirroring what settles.
export function StreamedPanel({
  label,
  fallback,
  children,
}: {
  label: string;
  fallback: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={<LoadingRegion label={label}>{fallback}</LoadingRegion>}
    >
      <div className="space-y-4">{children}</div>
    </Suspense>
  );
}

// ScreenFrame: the frame of a screen of the panel: the heading at once, the content streaming in
// below it. Takes the props of `StreamedPanel` and the two lines of the heading.
export function ScreenFrame({
  heading,
  subtitle,
  ...panel
}: {
  heading: string;
  subtitle: string;
  label: string;
  fallback: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHead heading={heading} subtitle={subtitle} />
      <StreamedPanel {...panel} />
    </div>
  );
}
