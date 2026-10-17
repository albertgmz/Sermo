"use client";

import { useEffect, useRef } from "react";

// Keeps the open link of a scrolling row of links in view: on a phone the open group can sit past
// the right edge.
export function ScrollToCurrent({ children }: { children: React.ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    row.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, []);
  return <div ref={row}>{children}</div>;
}
