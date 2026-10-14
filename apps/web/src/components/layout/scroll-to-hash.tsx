"use client";

import { useEffect } from "react";
import { drawnById, scrollToHash } from "@/components/layout/hash-scroll";
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
  // A link followed is a new arrival, not a visit by history.
  document.addEventListener("click", () => traversals.reset(), true);
}

// Mounted on a page whose sections stream in: scrolls to the one the address names (`#appearance`)
// once it is drawn, on a load and after a navigation from another page. A visit by history keeps
// the position the router restores.
export function ScrollToHash() {
  useEffect(() => {
    return scrollToHash({
      hash: () => window.location.hash,
      find: (id) => drawnById(document, id),
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
