"use client";

import { useSearchParams } from "next/navigation";
import { type MouseEvent, type ReactNode, useState } from "react";
import { busyOf, holdAt, pressAt, pressed, settle } from "@/lib/pending-choice";

// A filter and the list under it, the filter a menu of links: a choice pressed is a navigation, and
// its menu closes at once, so nothing else says it was taken. Until the address changes the list
// dims (`data-switch-panel`) and the part is marked busy (the rule: `lib/pending-choice`).
export function PendingChoice({ children }: { children: ReactNode }) {
  const search = useSearchParams().toString();
  const [kept, hold] = useState(() => holdAt(search));
  // A new address (the choice arrived, Back, Forward) ends the wait, before it is drawn.
  const held = settle(kept, search);
  if (held !== kept) hold(held);

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    const link = (event.target as Element).closest<HTMLAnchorElement>(
      "a[href]",
    );
    if (!link || event.button !== 0) return;
    hold(
      pressed(
        held,
        pressAt(link.href, new URL(location.href), {
          newTab:
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            Boolean(link.target),
          inMenu: link.closest('[role="menu"]') !== null,
        }),
      ),
    );
  }

  return (
    <div
      aria-busy={busyOf(held) || undefined}
      onClickCapture={onClickCapture}
      className="[&_[data-switch-panel]]:transition-opacity [&[aria-busy=true]_[data-switch-panel]]:opacity-60"
    >
      {children}
    </div>
  );
}
