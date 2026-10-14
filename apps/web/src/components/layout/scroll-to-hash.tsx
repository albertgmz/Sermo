"use client";

import { useEffect } from "react";
import { scrollToHash } from "@/components/layout/hash-scroll";
import { createTraversalGuard } from "@/components/layout/spotlight";

const after = (run: () => void, ms: number) => {
  const timer = window.setTimeout(run, ms);
  return () => window.clearTimeout(timer);
};

// Back and Forward announce themselves before the page mounts again: the router puts the reader
// back where they were, so the address is not followed again.
const traversals = createTraversalGuard(after);
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => traversals.traversal());
}

// The load type describes the arrival of the document only, not the navigations after it.
let firstArrival = true;

// Mounted on a page whose sections stream in: scrolls to the one the address names (`#appearance`)
// once it is drawn, on a first load and after a navigation from another page. A reload or a visit
// by history keeps the position the browser restores.
export function ScrollToHash() {
  useEffect(() => {
    const loaded = firstArrival;
    firstArrival = false;
    const [entry] = performance.getEntriesByType("navigation");
    return scrollToHash({
      hash: () => window.location.hash,
      find: (id) => document.getElementById(id),
      navigationType: () =>
        loaded ? (entry as PerformanceNavigationTiming)?.type : undefined,
      traversal: () => traversals.consume(),
      on: (type, listener) => {
        const options = { capture: true, passive: true };
        window.addEventListener(type, listener, options);
        return () => window.removeEventListener(type, listener, options);
      },
      later: after,
    });
  }, []);
  return null;
}
