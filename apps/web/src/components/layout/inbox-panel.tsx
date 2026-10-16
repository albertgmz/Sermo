"use client";

import { Bell, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { lazy, Suspense } from "react";
import { headerIconClass } from "@/components/layout/header-icon-class";
import { HeaderPanel } from "@/components/layout/header-panel";
import {
  loadAlerts,
  loadConversations,
} from "@/components/layout/panel-actions";
import { PanelSkeleton } from "@/components/layout/panel-skeleton";
import { useCounter } from "@/lib/counters";
import { cn } from "@/lib/utils";

const KINDS = {
  conversations: {
    counter: "conversations",
    messages: "messages",
    icon: Mail,
    load: loadConversations,
  },
  alerts: {
    counter: "notifications",
    messages: "alerts",
    icon: Bell,
    load: loadAlerts,
  },
} as const;

// The list (and React Query's observer with it) is fetched when a panel first opens, as the panel's
// own code is: the first load of a page carries only the buttons.
const MenuList = lazy(() =>
  import("@/components/layout/user-menu-list").then((module) => ({
    default: module.MenuList,
  })),
);

// A member's Messages (envelope) or Alerts (bell) button in the header, with its unread count, and
// the panel it opens: the latest rows, asked for when it opens, and the footer the server drew
// (view all, then new conversation or mark all read). The count follows the counters poll; a page
// drawn again after a read (`router.refresh`) brings the new one.
export function InboxPanel(props: {
  kind: keyof typeof KINDS;
  // The unread count the page drew.
  unread: number;
  footer: React.ReactNode;
  className?: string;
}) {
  const { kind, unread, footer, className } = props;
  const { counter, messages, icon: Icon, load } = KINDS[kind];
  const t = useTranslations("layout.headerPanels");
  const count = useCounter(counter, unread, props);
  const loading = t(`${messages}.loading`);
  return (
    <HeaderPanel
      label={t(`${messages}.title`)}
      title={t(`${messages}.title`)}
      unread={count}
      icon={<Icon />}
      className={cn(headerIconClass, className)}
    >
      <Suspense fallback={<PanelSkeleton label={loading} />}>
        <MenuList
          kind={kind}
          count={count}
          load={load}
          loadingLabel={loading}
        />
      </Suspense>
      {footer}
    </HeaderPanel>
  );
}
