"use client";

import { useState, useSyncExternalStore } from "react";
import {
  UserMenuBody,
  type UserMenuBodyProps,
} from "@/components/layout/user-menu-body";
import {
  MENU_TRIGGER_CLASS,
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

// Wide enough for the popover: Tailwind's `md`. Below it the menu is a sheet.
const WIDE = "(min-width: 48rem)";

function subscribeWide(listener: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function useWide() {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

export type UserMenuPopupProps = Omit<
  UserMenuBodyProps,
  "tab" | "onTabChange"
> & {
  label: string;
  title: string;
  // What the button holds: the small avatar, the arrow and the badge.
  trigger: React.ReactNode;
};

// The avatar button and the menu it opens, which Base UI draws: a popover on a wide screen and a
// sheet on a phone, with the same tabs in both. It is loaded when the plain button of `UserMenu`
// is pressed, and mounts open on the tab that has something unread.
export default function UserMenuPopup(props: UserMenuPopupProps) {
  const { label, title, trigger, ...body } = props;
  const wide = useWide();
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState<MenuTab>(() => openingTab(body.unread));

  function change(next: boolean) {
    if (next) setTab(openingTab(body.unread));
    setOpen(next);
  }
  // Following a link inside the menu closes it.
  function closeOnLink(event: React.MouseEvent) {
    if (event.defaultPrevented) return;
    if ((event.target as Element).closest("a")) change(false);
  }

  const menu = <UserMenuBody {...body} tab={tab} onTabChange={setTab} />;

  if (wide) {
    return (
      <Popover open={open} onOpenChange={change}>
        <PopoverTrigger aria-label={label} className={MENU_TRIGGER_CLASS}>
          {trigger}
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="w-[26rem] max-w-[calc(100vw-1rem)] gap-0 p-0"
          onClick={closeOnLink}
        >
          <PopoverTitle className="sr-only">{title}</PopoverTitle>
          {menu}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetTrigger aria-label={label} className={MENU_TRIGGER_CLASS}>
        {trigger}
      </SheetTrigger>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[85dvh] gap-0 overflow-y-auto p-0 pb-[env(safe-area-inset-bottom)]"
        onClick={closeOnLink}
      >
        <SheetTitle className="sr-only">{title}</SheetTitle>
        {menu}
      </SheetContent>
    </Sheet>
  );
}
