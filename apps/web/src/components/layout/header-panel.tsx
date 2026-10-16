"use client";

import { useTranslations } from "next-intl";
import type { HeaderPanelPopupProps } from "@/components/layout/header-panel-popup";
import { CountBadge } from "@/components/ui/count-badge";
import { LazyPopup } from "@/components/ui/lazy-popup";
import { cn } from "@/lib/utils";

const TRIGGER =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring data-popup-open:text-foreground";

const loadPopup = () => import("@/components/layout/header-panel-popup");

// A header icon that opens a panel under it, at every width: on a phone the panel is never wider
// than the screen. An unread count is drawn on the icon as a number. Following a link inside the
// panel closes it. The panel's code (Base UI) is fetched when the icon is first reached for; until
// then the icon is a plain button.
export function HeaderPanel({
  label,
  title,
  unread = 0,
  icon,
  className,
  shortcut,
  children,
}: {
  label: string;
  title: string;
  unread?: number;
  icon: React.ReactNode;
  className?: string;
  // The name a keyboard shortcut finds this button by (`data-shortcut`).
  shortcut?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("layout.headerPanel");
  const name = unread ? t("aria.unread", { label, count: unread }) : label;
  const classes = cn(TRIGGER, className);
  const trigger = (
    <>
      {icon}
      <CountBadge count={unread} className="top-1 left-5" />
    </>
  );
  const popup: HeaderPanelPopupProps = {
    label: name,
    title,
    trigger,
    className: classes,
    shortcut,
    children,
  };
  return (
    <LazyPopup
      load={loadPopup}
      popup={popup}
      trigger={(lazy) => (
        <button
          type="button"
          data-slot="popover-trigger"
          data-shortcut={shortcut}
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-label={name}
          className={classes}
          {...lazy}
        >
          {trigger}
        </button>
      )}
    />
  );
}
