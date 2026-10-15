"use client";

import { useTranslations } from "next-intl";
import type { HeaderPanelPopupProps } from "@/components/layout/header-panel-popup";
import { LazyPopup } from "@/components/ui/lazy-popup";
import { cn } from "@/lib/utils";

const TRIGGER =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring data-popup-open:text-foreground";

const loadPopup = () => import("@/components/layout/header-panel-popup");

// A header icon that opens a panel under it, at every width: on a phone the panel is never wider
// than the screen. Following a link inside the panel closes it. The panel's code (Base UI) is fetched when the icon is
// first reached for; until then the icon is a plain button.
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
      {unread > 0 && (
        <span className="absolute top-2 right-2 size-2 rounded-full bg-primary ring-2 ring-background" />
      )}
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
