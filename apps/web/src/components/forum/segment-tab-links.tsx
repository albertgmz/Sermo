"use client";

import { useLinkStatus } from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import type { ComponentProps } from "react";
import { TabLinks } from "@/components/forum/tab-links";
import { cn } from "@/lib/utils";

// A tab bar whose tabs are the pages under a layout, one route segment each. The layout draws it
// and keeps it on screen across the tabs: a tab pressed is a navigation (`next/link`, prefetched)
// to its page, which draws only its own panel, behind its own `loading.tsx`. The open tab is the
// one whose `value` is the segment the address names (`useSelectedLayoutSegment`), "" for the
// layout's own page; it carries `aria-current="page"`, and a live region beside the bar says it.
// A tab being followed looks open at once, while its page is still on its way (`useLinkStatus`,
// which says nothing when the page's shell is already in the browser: then it shows at once
// anyway).

// In each link: marks the link while the router follows it. Hidden; the bar draws the link.
function PendingHint() {
  const { pending } = useLinkStatus();
  return pending ? <span hidden data-tab-pending="" /> : null;
}

// While a link is being followed, it takes the open tab's look and the open tab loses it, per
// look of the bar: one tab looks open. `aria-current` stays on the page on screen.
const PENDING = {
  underline:
    "*:has-[[data-tab-pending]]:border-primary has-[[data-tab-pending]]:*:aria-[current=page]:not-has-[[data-tab-pending]]:border-transparent",
  segmented:
    "*:has-[[data-tab-pending]]:bg-muted has-[[data-tab-pending]]:*:aria-[current=page]:not-has-[[data-tab-pending]]:bg-transparent",
  plain: "",
};

export function SegmentTabLinks({
  tabs,
  variant = "underline",
  className,
  ...props
}: Omit<ComponentProps<typeof TabLinks>, "active">) {
  const active = useSelectedLayoutSegment() ?? "";
  return (
    <>
      <TabLinks
        {...props}
        variant={variant}
        className={cn(
          "*:has-[[data-tab-pending]]:text-foreground has-[[data-tab-pending]]:*:aria-[current=page]:not-has-[[data-tab-pending]]:text-muted-foreground",
          PENDING[variant],
          className,
        )}
        tabs={tabs.map((tab) => ({
          ...tab,
          icon: (
            <>
              <PendingHint />
              {tab.icon}
            </>
          ),
        }))}
        active={active}
      />
      {/* The tab that opened, for a screen reader: a live region on the page from the start, so it
          is heard whenever the page's title comes (Next's route announcer reads the title only
          when the route changes). */}
      <span role="status" className="sr-only">
        {tabs.find((tab) => tab.value === active)?.label ?? ""}
      </span>
    </>
  );
}
