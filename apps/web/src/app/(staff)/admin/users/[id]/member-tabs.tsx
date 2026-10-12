"use client";

// The tab strip of a member: the tabs the viewer may open, the one at the current address marked.

import { usePathname } from "next/navigation";
import { type TabLink, TabLinks } from "@/components/forum/tab-links";

export function MemberTabs({
  tabs,
  label,
}: {
  tabs: TabLink[];
  label: string;
}) {
  const pathname = usePathname();
  // The longest address that is the current one or its parent wins ("/admin/users/7" is also
  // the parent of every other tab).
  const active =
    [...tabs]
      .sort((a, b) => b.href.length - a.href.length)
      .find(
        (tab) => pathname === tab.href || pathname.startsWith(`${tab.href}/`),
      )?.value ?? "";
  return <TabLinks tabs={tabs} active={active} label={label} />;
}
