import { type ReactNode, Suspense } from "react";

// A part of a screen that streams in behind its placeholder on a page load. Drawn for a part
// changed in place (`inPlace`, by a `TabSwitch` or `PageSwitch` loader) it has none: the switch
// keeps the old part on screen until all of the new one has arrived, and a placeholder would show
// in between.
export function Streamed({
  inPlace,
  fallback,
  children,
}: {
  inPlace: boolean;
  fallback: ReactNode;
  children: ReactNode;
}) {
  return inPlace ? (
    children
  ) : (
    <Suspense fallback={fallback}>{children}</Suspense>
  );
}
