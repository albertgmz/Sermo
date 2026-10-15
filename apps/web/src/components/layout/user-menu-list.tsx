"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { PanelSkeleton } from "@/components/layout/panel-skeleton";
import {
  type ListKind,
  listQuery,
} from "@/components/layout/user-menu-list-query";

// The rows of one tab of the avatar menu. `load` is a server action that returns the rows drawn, so
// the avatars keep reading the LITE cookie. The component is mounted when its tab opens and not
// before, which is when the list is first asked for; nothing is kept once the tab closes (the rows
// belong to the member who opened it).
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
