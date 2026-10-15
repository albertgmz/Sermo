"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import {
  UserMenuBody,
  type UserMenuBodyProps,
} from "@/components/layout/user-menu-body";
import {
  badgeText,
  combinedUnread,
  type MenuTab,
  openingTab,
} from "@/components/layout/user-menu-tabs";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useCounter } from "@/lib/counters";

// Wide enough for the popover: Tailwind's `md`. Below it the menu is a sheet.
const WIDE = "(min-width: 48rem)";

function subscribeWide(listener: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

// The server draws the narrow form; the menu is closed then, so nothing shows the difference.
function useWide() {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

const TRIGGER =
  "group relative flex h-10 items-center gap-1.5 rounded-md px-1.5 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:text-foreground";

type Props = Omit<UserMenuBodyProps, "unread" | "tab" | "onTabChange"> & {
  // The trigger's picture, small.
  triggerAvatar: React.ReactNode;
  // The unread counts the page drew; polls find newer ones.
  unread: { notifications: number; conversations: number };
};

// The member's menu, shared by the site header and the staff panel's top bar: the avatar carries
// one badge (alerts and conversations together) and opens a popover on a wide screen and a sheet on
// a phone, with the same tabs in both. It opens on the tab that has something unread.
export function UserMenu(props: Props) {
  const { triggerAvatar, unread: drawn, ...body } = props;
  const t = useTranslations("layout.userMenu");
  const wide = useWide();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<MenuTab>("account");
  const unread = {
    notifications: useCounter("notifications", drawn.notifications, props),
    conversations: useCounter("conversations", drawn.conversations, props),
  };
  const total = combinedUnread(unread);

  function change(next: boolean) {
    if (next) setTab(openingTab(unread));
    setOpen(next);
  }
  // Following a link inside the menu closes it.
  function closeOnLink(event: React.MouseEvent) {
    if (event.defaultPrevented) return;
    if ((event.target as Element).closest("a")) change(false);
  }

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
  const menu = (
    <UserMenuBody {...body} unread={unread} tab={tab} onTabChange={setTab} />
  );

  if (wide) {
    return (
      <Popover open={open} onOpenChange={change}>
        <PopoverTrigger aria-label={label} className={TRIGGER}>
          {trigger}
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-[26rem] max-w-[calc(100vw-1rem)] gap-0 p-0"
          onClick={closeOnLink}
        >
          <PopoverTitle className="sr-only">{t("aria.account")}</PopoverTitle>
          {menu}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetTrigger aria-label={label} className={TRIGGER}>
        {trigger}
      </SheetTrigger>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[85dvh] gap-0 overflow-y-auto p-0 pb-[env(safe-area-inset-bottom)]"
        onClick={closeOnLink}
      >
        <SheetTitle className="sr-only">{t("aria.account")}</SheetTitle>
        {menu}
      </SheetContent>
    </Sheet>
  );
}
