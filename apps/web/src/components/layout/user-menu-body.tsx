"use client";

import { Bell, Bookmark, Inbox, LogOut, UserCog } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DATA_SAVER_HREF } from "@/app/[locale]/(main)/account/links";
import { logout } from "@/app/[locale]/(main)/actions";
import { DataSaverLink } from "@/components/layout/data-saver-menu-item";
import { type LinkItem, linkProps } from "@/components/layout/nav";
import { NavLabel } from "@/components/layout/nav-label";
import {
  loadAlerts,
  loadBookmarks,
  loadConversations,
} from "@/components/layout/panel-actions";
import { postStatus } from "@/components/layout/status-action";
import { StatusForm } from "@/components/layout/status-form";
import { ThemeControl } from "@/components/layout/theme-control";
import { MenuList } from "@/components/layout/user-menu-list";
import {
  badgeText,
  type MenuTab,
  type MenuUnread,
} from "@/components/layout/user-menu-tabs";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LiteState } from "@/lib/lite-preferences";

const ROW =
  "flex min-h-10 items-center gap-2 rounded-md px-3 text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring md:min-h-8";

const TAB_ICONS = {
  alerts: Bell,
  conversations: Inbox,
  account: UserCog,
  bookmarks: Bookmark,
} as const;

// What the menu holds, shared by the popover of a wide screen and the sheet of a phone. Everything
// drawn on the server (the pictures, the footers of the lists) arrives as an element, so the
// avatars keep reading the Data saver cookie.
export type UserMenuBodyProps = {
  user: { username: string; title: string };
  avatar: React.ReactNode;
  links: LinkItem[];
  screenLinks: { href: string; label: string }[];
  lite: LiteState;
  unread: MenuUnread;
  tab: MenuTab;
  onTabChange: (tab: MenuTab) => void;
  footers: {
    alerts: React.ReactNode;
    conversations: React.ReactNode;
    bookmarks: React.ReactNode;
  };
  // The wall the status goes to; absent when the member may not post there.
  status?: { wallHref: string };
};

function TabBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className="absolute top-1 left-1/2 ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] leading-none font-semibold text-primary-foreground"
    >
      {badgeText(count)}
    </span>
  );
}

export function UserMenuBody(props: UserMenuBodyProps) {
  const {
    user,
    avatar,
    links,
    screenLinks,
    lite,
    unread,
    tab,
    footers,
    status,
  } = props;
  const t = useTranslations("layout.userMenu");
  const lists = useTranslations("layout.headerPanels");
  const counts: Record<MenuTab, number> = {
    alerts: unread.notifications,
    conversations: unread.conversations,
    account: 0,
    bookmarks: 0,
  };
  return (
    <>
      <div className="flex items-center gap-3 p-4">
        <Link
          href="/account"
          aria-label={t("editPicture")}
          className="relative shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {avatar}
          <span className="absolute inset-x-0 -bottom-1 mx-auto w-fit rounded-full bg-background px-1.5 text-[0.625rem] leading-4 font-medium text-foreground ring-1 ring-border">
            {t("edit")}
          </span>
        </Link>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{user.username}</p>
          <p className="truncate text-xs text-muted-foreground">{user.title}</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10 shrink-0 md:h-8"
          onClick={() => logout()}
        >
          <LogOut />
          {t("logout")}
        </Button>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => props.onTabChange(value as MenuTab)}
        className="gap-0 border-t"
      >
        <TabsList
          variant="line"
          aria-label={t("aria.tabs")}
          className="grid w-full grid-cols-4 gap-0 rounded-none border-b p-0 group-data-horizontal/tabs:h-12"
        >
          {(Object.keys(TAB_ICONS) as MenuTab[]).map((name) => {
            const Icon = TAB_ICONS[name];
            const count = counts[name];
            return (
              <TabsTrigger
                key={name}
                value={name}
                aria-label={
                  count > 0
                    ? t("tabUnread", { label: t(`tabs.${name}`), count })
                    : t(`tabs.${name}`)
                }
                title={t(`tabs.${name}`)}
                className="h-full min-h-10 rounded-none group-data-horizontal/tabs:after:bottom-0"
              >
                <Icon aria-hidden="true" className="size-5" />
                <TabBadge count={count} />
              </TabsTrigger>
            );
          })}
        </TabsList>
        <TabsContent value="alerts">
          <MenuList
            kind="alerts"
            count={unread.notifications}
            load={loadAlerts}
            loadingLabel={lists("alerts.loading")}
          />
          {footers.alerts}
        </TabsContent>
        <TabsContent value="conversations">
          <MenuList
            kind="conversations"
            count={unread.conversations}
            load={loadConversations}
            loadingLabel={lists("messages.loading")}
          />
          {footers.conversations}
        </TabsContent>
        <TabsContent value="account">
          <ul className="grid grid-cols-2 gap-x-1 p-2">
            {links.map((link) => (
              <li key={link.id}>
                <Link {...linkProps(link)} className={ROW}>
                  <NavLabel item={link} withDefault />
                </Link>
              </li>
            ))}
            {screenLinks.map(({ href, label }) => (
              <li key={href}>
                {href === DATA_SAVER_HREF ? (
                  <DataSaverLink
                    state={lite}
                    href={DATA_SAVER_HREF}
                    className={ROW}
                  />
                ) : (
                  <Link href={href} className={ROW}>
                    {label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t px-4 py-2">
            <span className="text-sm text-muted-foreground">{t("theme")}</span>
            <ThemeControl />
          </div>
        </TabsContent>
        <TabsContent value="bookmarks">
          <MenuList
            kind="bookmarks"
            count={0}
            load={loadBookmarks}
            loadingLabel={t("bookmarks.loading")}
          />
          {footers.bookmarks}
        </TabsContent>
      </Tabs>
      {status && <StatusForm action={postStatus} wallHref={status.wallHref} />}
    </>
  );
}
