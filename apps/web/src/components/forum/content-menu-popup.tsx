"use client";

import { Check, Ellipsis, Pencil, Share2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  linkTo,
  ShareMenuBody,
  shareNatively,
} from "@/components/forum/share-button";
import { useLinkCopy } from "@/components/forum/share-popup";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { useMenuOpening } from "@/components/ui/lazy-popup-focus";

export type ContentMenuPopupProps = {
  className: string;
  // The item's permalink.
  share?: string;
  // A page to edit on, or what opens the edit panel under the bar.
  edit?: string | (() => void);
  // What opens the delete panel under the bar.
  onDelete?: () => void;
};

const itemClass = "min-h-10 md:min-h-8";

// The button and its menu, which Base UI draws. It is loaded when the plain button of
// `ContentMenu` is pressed and mounts open. Share opens the device's share sheet where there is
// one; elsewhere it copies the link and says so, or shows the link to copy by hand.
export default function ContentMenuPopup({
  className,
  share,
  edit,
  onDelete,
  openedBy,
  openKey,
}: ContentMenuPopupProps & OpenedProps) {
  const t = useTranslations("forum.contentActions");
  const shareText = useTranslations("forum.shareButton");
  const { defaultOpen, trigger } = useMenuOpening(openedBy, openKey);
  const [open, setOpen] = useState(defaultOpen);
  const link = useLinkCopy(share ?? "", () => setOpen(false));

  function change(next: boolean) {
    link.reset();
    setOpen(next);
  }

  // A share sheet that fails opens the menu again on the copied link (or the field to copy it).
  function shareItem(href: string) {
    const copy = () => void link.copy();
    const reopen = () => {
      setOpen(true);
      copy();
    };
    if (shareNatively(linkTo(href), navigator, reopen)) {
      setOpen(false);
      return;
    }
    copy();
  }

  return (
    <DropdownMenu open={open} onOpenChange={change}>
      <DropdownMenuTrigger
        ref={trigger}
        aria-label={t("moreOptions")}
        className={className}
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-40">
        {share &&
          (link.status === "manual" ? (
            <ShareMenuBody url={link.url} status="manual" onCopy={link.copy} />
          ) : (
            <DropdownMenuItem
              className={itemClass}
              closeOnClick={false}
              onClick={() => shareItem(share)}
            >
              {link.status === "copied" ? <Check /> : <Share2 />}
              {link.status === "copied" ? shareText("copied") : t("share")}
            </DropdownMenuItem>
          ))}
        {edit &&
          (typeof edit === "string" ? (
            <DropdownMenuItem
              className={itemClass}
              render={<Link href={edit} />}
            >
              <Pencil />
              {t("edit")}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className={itemClass} onClick={edit}>
              <Pencil />
              {t("edit")}
            </DropdownMenuItem>
          ))}
        {onDelete && (
          <DropdownMenuItem className={itemClass} onClick={onDelete}>
            <Trash2 />
            {t("delete")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
