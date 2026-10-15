"use client";

import { useEffect } from "react";
import { announceViewerChange, enterViewer } from "@/lib/session-epoch";

// Tells the tab who the page is drawn for. The tab outlives a sign-out and a sign-in (they are
// redirects), so what it remembers for the earlier visitor (changes they made, counts a poll found,
// the end of the list they were reading) is dropped as soon as the page is drawn for someone else.
// Drawn once in the layout, before anything that reads those stores.
export function ViewerScope({ viewerId }: { viewerId: number | null }) {
  // While rendering, so that nothing of the earlier visitor is drawn for the next one; the
  // components are told in the effect.
  if (typeof window !== "undefined") enterViewer(viewerId);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a different visitor is the trigger
  useEffect(() => {
    announceViewerChange();
  }, [viewerId]);
  return null;
}
