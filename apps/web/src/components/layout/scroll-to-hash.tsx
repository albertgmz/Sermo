"use client";

import { useEffect } from "react";
import { scrollToHash } from "@/components/layout/hash-scroll";

// Mounted on a page whose sections stream in: scrolls to the one the address names (`#appearance`)
// once it is drawn, on a first load and after a navigation from another page.
export function ScrollToHash() {
  useEffect(
    () =>
      scrollToHash({
        hash: () => window.location.hash,
        find: (id) => document.getElementById(id),
        later: (run, ms) => {
          const timer = window.setTimeout(run, ms);
          return () => window.clearTimeout(timer);
        },
      }),
    [],
  );
  return null;
}
