"use client";

import { useSearchParams } from "next/navigation";
import { type MouseEvent, type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

// The query a menu choice names, when the link pressed is a choice of a menu that opens this same
// page with another query (a filter); null for anything else (another page, a new tab, a pager).
export function chosenQuery(
  href: string,
  here: URL,
  { newTab, inMenu }: { newTab: boolean; inMenu: boolean },
) {
  if (newTab || !inMenu) return null;
  const url = new URL(href, here);
  if (url.origin !== here.origin || url.pathname !== here.pathname) return null;
  return new URLSearchParams(url.search).toString();
}

// A filter and the list under it, the filter a menu of links: a choice pressed is a navigation, and
// its menu closes at once, so nothing else says it was taken. Until the address names the choice
// the list dims (`data-switch-panel`) and the part is marked busy.
export function PendingChoice({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const search = useSearchParams().toString();
  const [chosen, setChosen] = useState<string | null>(null);
  const busy = chosen !== null && chosen !== search;

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as Element).closest<HTMLAnchorElement>(
      "a[href]",
    );
    if (!link || event.defaultPrevented || event.button !== 0) return;
    setChosen(
      chosenQuery(link.href, new URL(location.href), {
        newTab:
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          Boolean(link.target),
        inMenu: link.closest('[role="menu"]') !== null,
      }),
    );
  }

  return (
    <div
      aria-busy={busy || undefined}
      onClickCapture={onClickCapture}
      className={cn(
        "[&_[data-switch-panel]]:transition-opacity [&[aria-busy=true]_[data-switch-panel]]:opacity-60",
        className,
      )}
    >
      {children}
    </div>
  );
}
