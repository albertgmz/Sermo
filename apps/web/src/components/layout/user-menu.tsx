"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { UserMenuBodyProps } from "@/components/layout/user-menu-body";
import type { UserMenuPopupProps } from "@/components/layout/user-menu-popup";
import {
  badgeText,
  combinedUnread,
  MENU_TRIGGER_CLASS,
} from "@/components/layout/user-menu-tabs";
import { LazyPopup } from "@/components/ui/lazy-popup";
import { useCounter } from "@/lib/counters";

// The menu itself (Base UI, the tabs, the lists) is fetched when the button is first reached for.
const loadPopup = () => import("@/components/layout/user-menu-popup");

type Props = Omit<UserMenuBodyProps, "unread" | "tab" | "onTabChange"> & {
  // The trigger's picture, small.
  triggerAvatar: React.ReactNode;
  // The unread counts the page drew; polls find newer ones.
  unread: { notifications: number; conversations: number };
};

// The member's menu, shared by the site header and the staff panel's top bar: the avatar carries
// one badge (alerts and conversations together) and opens a popover on a wide screen and a sheet on
// a phone, with the same tabs in both. It opens on the tab that has something unread. Until it is
// reached for, the avatar is a plain button; the badge follows the counts either way.
export function UserMenu(props: Props) {
  const { triggerAvatar, unread: drawn, ...body } = props;
  const t = useTranslations("layout.userMenu");
  const unread = {
    notifications: useCounter("notifications", drawn.notifications, props),
    conversations: useCounter("conversations", drawn.conversations, props),
  };
  const total = combinedUnread(unread);

  const label = total
    ? t("aria.accountUnread", { count: total })
    : t("aria.account");
  const trigger = (
    <>
      {triggerAvatar}
      <ChevronDown className="size-3.5 transition-transform group-data-popup-open:rotate-180" />
      {total > 0 && (
        <span
          aria-hidden="true"
          className="absolute -top-0.5 left-6 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] leading-none font-semibold text-primary-foreground ring-2 ring-background"
        >
          {badgeText(total)}
        </span>
      )}
    </>
  );
  const popup: UserMenuPopupProps = {
    ...body,
    unread,
    label,
    title: t("aria.account"),
    trigger,
  };
  return (
    <LazyPopup
      load={loadPopup}
      popup={popup}
      trigger={(lazy) => (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-label={label}
          className={MENU_TRIGGER_CLASS}
          {...lazy}
        >
          {trigger}
        </button>
      )}
    />
  );
}
