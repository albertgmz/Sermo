"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { UserMenuBodyProps } from "@/components/layout/user-menu-body";
import type { UserMenuPopupProps } from "@/components/layout/user-menu-popup";
import { MENU_TRIGGER_CLASS } from "@/components/layout/user-menu-tabs";
import { LazyPopup } from "@/components/ui/lazy-popup";

// The menu itself (Base UI, the tabs, the lists) is fetched when the button is first reached for.
const loadPopup = () => import("@/components/layout/user-menu-popup");

type Props = Omit<UserMenuBodyProps, "tab" | "onTabChange"> & {
  // The trigger's picture, small.
  triggerAvatar: React.ReactNode;
};

// The member's account menu, shared by the site header and the staff panel's top bar: the avatar
// opens a popover on a wide screen and a sheet on a phone, with the same tabs in both. It carries
// no count: alerts and conversations have their own buttons. Until it is reached for, the avatar is
// a plain button.
export function UserMenu(props: Props) {
  const { triggerAvatar, ...body } = props;
  const t = useTranslations("layout.userMenu");
  const label = t("aria.account");
  const trigger = (
    <>
      {triggerAvatar}
      <ChevronDown className="size-3.5 transition-transform group-data-popup-open:rotate-180" />
    </>
  );
  const popup: UserMenuPopupProps = {
    ...body,
    label,
    title: label,
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
