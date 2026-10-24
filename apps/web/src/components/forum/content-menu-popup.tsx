"use client";

import { Ellipsis, Pencil, Trash2 } from "lucide-react";
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
  // What opens the edit panel under the bar.
  onEdit?: () => void;
  // What opens the delete panel under the bar.
  onDelete?: () => void;
  // The item is already deleted: its delete is the permanent one.
  permanentOnly?: boolean;
};

// What the menu holds, in XenForo's order: edit, then delete; each opens its panel under the bar.
export function menuEntries({
  onEdit,
  onDelete,
}: Pick<ContentMenuPopupProps, "onEdit" | "onDelete">) {
  const entries: { id: "edit" | "delete"; select: () => void }[] = [];
  if (onEdit) entries.push({ id: "edit", select: onEdit });
  if (onDelete) entries.push({ id: "delete", select: onDelete });
  return entries;
}

const ICONS = { edit: Pencil, delete: Trash2 };

// The button and its menu, which Base UI draws. It is loaded when the plain button of
// `ContentMenu` is pressed and mounts open.
export default function ContentMenuPopup({
  className,
  onEdit,
  onDelete,
  permanentOnly,
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
        {menuEntries({ onEdit, onDelete }).map((entry) => {
          const Icon = ICONS[entry.id];
          return (
            <DropdownMenuItem
              key={entry.id}
              className="min-h-10 md:min-h-8"
              onClick={entry.select}
            >
              <Icon />
              {t(
                entry.id === "delete" && permanentOnly
                  ? "hardDelete"
                  : entry.id,
              )}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
