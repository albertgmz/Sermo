"use client";

import { Check, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { actionLabelClass } from "@/components/forum/message-action";
import {
  copyLink,
  linkTo,
  ShareMenuBody,
  shareNatively,
} from "@/components/forum/share-button";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { usePopupFocus } from "@/components/ui/lazy-popup-focus";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SharePopupProps = {
  href: string;
  label?: string;
  className?: string;
};

// Copies the link to `href` (`linkTo`) and says how it went: `copied`, back to `idle` a moment
// later, when `done` runs too; `manual` where the clipboard refused it, with the `url` to copy by
// hand. Shared by this menu and the "•••" menu of a wall post or comment (`content-menu-popup`).
export function useLinkCopy(href: string, done: () => void) {
  const [status, setStatus] = useState<"idle" | "copied" | "manual">("idle");
  const [url, setUrl] = useState("");

  async function copy() {
    const target = linkTo(href);
    setUrl(target);
    if (await copyLink(target, navigator)) {
      setStatus("copied");
      setTimeout(() => {
        setStatus("idle");
        done();
      }, 2000);
    } else {
      setStatus("manual");
    }
  }

  return { status, url, copy, reset: () => setStatus("idle") };
}

// The share button and its menu, which Base UI draws. It is loaded when the plain button of
// `ShareButton` is pressed and mounts open.
export default function SharePopup({
  href,
  label,
  className,
  openedBy,
}: SharePopupProps & OpenedProps) {
  const t = useTranslations("forum.shareButton");
  const focus = usePopupFocus(openedBy);
  const [open, setOpen] = useState(true);
  const { status, url, copy, reset } = useLinkCopy(href, () => setOpen(false));

  function change(next: boolean) {
    if (next && shareNatively(linkTo(href), navigator, () => setOpen(true))) {
      return;
    }
    reset();
    setOpen(next);
  }

  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger
        aria-label={t("aria.share")}
        className={cn(className, status === "copied" && "text-success")}
      >
        {status === "copied" ? <Check /> : <Share2 />}
        {label && <span className={actionLabelClass}>{label}</span>}
      </PopoverTrigger>
      <PopoverContent
        ref={focus.ref}
        initialFocus={focus.initialFocus}
        align="end"
        className="w-auto gap-0 p-1"
      >
        <ShareMenuBody url={url} status={status} onCopy={copy} />
      </PopoverContent>
    </Popover>
  );
}
