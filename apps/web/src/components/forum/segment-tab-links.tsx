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
// layout's own page; it carries `aria-current="page"`. A tab being followed looks open at once,
// while its page is still on its way (`useLinkStatus`, which says nothing when the page's shell is
// already in the browser: then it shows at once anyway).

// In each link: marks the link while the router follows it. Hidden; the bar draws the link.
function PendingHint() {
  const { pending } = useLinkStatus();
  return pending ? <span hidden data-tab-pending="" /> : null;
}

// The look of a link being followed: that of the open tab, per look of the bar.
const PENDING = {
  underline: "*:has-[[data-tab-pending]]:border-primary",
  segmented: "*:has-[[data-tab-pending]]:bg-muted",
  plain: "",
};

export function SegmentTabLinks({
  tabs,
  variant = "underline",
  className,
  ...props
}: Omit<ComponentProps<typeof TabLinks>, "active">) {
  const segment = useSelectedLayoutSegment();
  return (
    <TabLinks
      {...props}
      variant={variant}
      className={cn(
        "*:has-[[data-tab-pending]]:text-foreground",
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
      active={segment ?? ""}
    />
  );
}
