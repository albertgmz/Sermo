"use client";

import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
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
  // A page to edit on, or what opens the edit panel under the bar.
  edit?: string | (() => void);
  // What opens the delete panel under the bar.
  onDelete?: () => void;
};

type Entry = { id: "edit" | "delete"; href?: string; select?: () => void };

// What the menu holds, in XenForo's order: edit, then delete. An entry goes to a page (`href`) or
// opens a panel under the bar (`select`).
export function menuEntries({
  edit,
  onDelete,
}: Pick<ContentMenuPopupProps, "edit" | "onDelete">): Entry[] {
  const entries: Entry[] = [];
  if (edit)
    entries.push(
      typeof edit === "string"
        ? { id: "edit", href: edit }
        : { id: "edit", select: edit },
    );
  if (onDelete) entries.push({ id: "delete", select: onDelete });
  return entries;
}

const ICONS = { edit: Pencil, delete: Trash2 };

// The button and its menu, which Base UI draws. It is loaded when the plain button of
// `ContentMenu` is pressed and mounts open.
export default function ContentMenuPopup({
  className,
  edit,
  onDelete,
  openedBy,
  openKey,
}: ContentMenuPopupProps & OpenedProps) {
  const t = useTranslations("forum.contentActions");
  const { defaultOpen, trigger } = useMenuOpening(openedBy, openKey);
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger
        ref={trigger}
        aria-label={t("moreOptions")}
        className={className}
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-40">
        {menuEntries({ edit, onDelete }).map((entry) => {
          const Icon = ICONS[entry.id];
          return (
            <DropdownMenuItem
              key={entry.id}
              className="min-h-10 md:min-h-8"
              onClick={entry.select}
              render={entry.href ? <Link href={entry.href} /> : undefined}
            >
              <Icon />
              {t(entry.id)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
