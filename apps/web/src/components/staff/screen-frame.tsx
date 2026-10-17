import { Suspense } from "react";
import { LoadingRegion } from "@/components/forum/skeletons";
import { type Crumb, PageHeader } from "./page-header";

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

// ScreenFrame: the frame of every page of the panel: the `PageHeader` at once, the content
// streaming in below it. Takes the props of `StreamedPanel` and the header's: `heading` (the
// title), optional `subtitle`, `trail` (`staffTrail(path)`) and `actions`. A page's `loading.tsx`
// uses `LoadingPage` (`(staff)/skeletons.tsx`), which holds the trail's row.
export function ScreenFrame({
  heading,
  subtitle,
  trail,
  actions,
  ...panel
}: {
  heading: string;
  subtitle?: string;
  trail?: Crumb[] | Promise<Crumb[]>;
  actions?: React.ReactNode;
  label: string;
  fallback: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={trail}
        title={heading}
        description={subtitle}
        actions={actions}
      />
      <StreamedPanel {...panel} />
    </div>
  );
}
