"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { TabLinks } from "@/components/forum/tab-links";

const TABS = [
  { value: "dashboard", href: "/admin" },
  { value: "forums", href: "/admin/forums" },
  { value: "members", href: "/admin/members" },
  { value: "settings", href: "/admin/settings" },
] as const;

export function AdminNavigation() {
  const t = useTranslations("admin.navigation");
  const pathname = usePathname();
  const active = pathname.split("/")[2] || "dashboard";

  return (
    <TabLinks
      tabs={TABS.map((tab) => ({ ...tab, label: t(tab.value) }))}
      active={active}
      label={t("aria.label")}
      className="grid grid-cols-2 sm:flex"
    />
  );
}
