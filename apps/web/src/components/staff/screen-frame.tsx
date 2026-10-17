import { Suspense } from "react";
import { PageHead } from "@/app/[locale]/(staff)/admin/groups/skeletons";
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

// ScreenFrame: the frame of every page of the panel: the heading at once, the content streaming
// in below it. Takes the props of `StreamedPanel` and the heading's: `heading` (the title),
// optional `subtitle`, and the `PageHeader` props `trail` (`staffTrail(path)`) and `actions`.
// With a trail or actions the heading is a `PageHeader`; without, the plain heading the screens
// not yet moved onto the patterns draw. A page's `loading.tsx` uses `HeadingSkeleton` with
// `trail` when the page has one.
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
      {trail || actions ? (
        <PageHeader
          trail={trail}
          title={heading}
          description={subtitle}
          actions={actions}
        />
      ) : (
        <PageHead heading={heading} subtitle={subtitle} />
      )}
      <StreamedPanel {...panel} />
    </div>
  );
}
