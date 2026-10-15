"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { pageViewReporter } from "./analytics-snippets";

declare global {
  interface Window {
    _paq?: unknown[][];
  }
}

// Reports the pages a visitor moves to without a page load. Renders nothing.
export function MatomoPageViews() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const report = useRef<ReturnType<typeof pageViewReporter>>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a navigation is a change of either
  useEffect(() => {
    report.current ??= pageViewReporter(() => {
      window._paq = window._paq || [];
      return window._paq;
    });
    // The title is set once the new page has rendered.
    const timer = setTimeout(
      () => report.current?.(window.location.href, document.title),
      0,
    );
    return () => clearTimeout(timer);
  }, [pathname, search]);
  return null;
}
