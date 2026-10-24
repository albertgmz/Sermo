"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { markAlertsViewed } from "@/app/[locale]/(main)/notifications/actions";
import { PanelSkeleton } from "@/components/layout/panel-skeleton";
import {
  type ListKind,
  listQuery,
} from "@/components/layout/user-menu-list-query";
import { viewAlerts } from "@/lib/alerts-viewed";

// The rows of a header panel or of a tab of the avatar menu. `load` is a server action that returns
// the rows drawn, so the avatars keep reading the LITE cookie. The component is mounted when its
// panel or tab opens and not before, which is when the list is first asked for; nothing is kept
// once it closes (the rows belong to the member who opened it). Opening the alerts marks them
// viewed, and again when one arrives while they are open.
export function MenuList({
  kind,
  count,
  load,
  loadingLabel,
}: {
  kind: ListKind;
  count: number;
  load: () => Promise<React.ReactNode>;
  loadingLabel: string;
}) {
  const t = useTranslations("layout.headerPanels");
  const query = useQuery(listQuery(kind, count, load));
  useEffect(() => {
    if (kind === "alerts" && count > 0) void viewAlerts(markAlertsViewed);
  }, [kind, count]);
  if (query.data !== undefined) return <>{query.data}</>;
  if (query.isError) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        {t("failed")}
      </p>
    );
  }
  return <PanelSkeleton label={loadingLabel} />;
}
