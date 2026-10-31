"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import type { ComponentProps } from "react";
import { TabLinks } from "@/components/forum/tab-links";

// A tab bar whose tabs are the pages under a layout, one route segment each. The layout draws it
// and keeps it on screen across the tabs: a tab pressed is a navigation (`next/link`, prefetched)
// to its page, which draws only its own panel, behind its own `loading.tsx`. The open tab is the
// one whose `value` is the segment the address names (`useSelectedLayoutSegment`), "" for the
// layout's own page; it carries `aria-current="page"`.
export function SegmentTabLinks(
  props: Omit<ComponentProps<typeof TabLinks>, "active">,
) {
  const segment = useSelectedLayoutSegment();
  return <TabLinks {...props} active={segment ?? ""} />;
}
