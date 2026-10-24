import { type ReactNode, Suspense } from "react";
import { isRouterRequest } from "@/lib/sermo/request-page";

// A part of a screen that streams in behind its placeholder on a page load. Drawn for a part
// changed in place (`inPlace`, by a `TabSwitch` or `PageSwitch` loader) it has none: the switch
// keeps the old part on screen until all of the new one has arrived, and a placeholder would show
// in between. The same when the router asks for the page (a refresh, the page drawn again behind
// an address it was given in the browser): the screen shows the part already, and the placeholder
// would take its place until the new one is there. So a screen with parts that change in place
// draws each of them through this, never through a bare `Suspense`.
export async function Streamed({
  inPlace = false,
  fallback,
  children,
}: {
  inPlace?: boolean;
  fallback: ReactNode;
  children: ReactNode;
}) {
  return inPlace || (await isRouterRequest()) ? (
    children
  ) : (
    <Suspense fallback={fallback}>{children}</Suspense>
  );
}
