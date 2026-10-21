"use client";

// RefreshWhile: renders nothing; while `active` it asks the router for a fresh render of the page
// every few seconds, so a panel that shows a background run's progress keeps up with it. It stops
// by itself when the page renders with `active` false.
//
// Props
//   active   Whether to keep refreshing.
//   every    Milliseconds between refreshes. Default: 4000.

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function RefreshWhile({
  active,
  every = 4000,
}: {
  active: boolean;
  every?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), every);
    return () => clearInterval(timer);
  }, [active, every, router]);
  return null;
}
