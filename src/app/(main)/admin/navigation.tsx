"use client";

import { usePathname } from "next/navigation";
import { TabLinks } from "@/components/forum/tab-links";

const TABS = [
  { value: "dashboard", label: "Dashboard", href: "/admin" },
  { value: "forums", label: "Forums", href: "/admin/forums" },
  { value: "members", label: "Members", href: "/admin/members" },
  { value: "settings", label: "Settings", href: "/admin/settings" },
];

export function AdminNavigation() {
  const pathname = usePathname();
  const active = pathname.split("/")[2] || "dashboard";

  return (
    <TabLinks
      tabs={TABS}
      active={active}
      label="Administration"
      className="grid grid-cols-2 sm:flex"
    />
  );
}
