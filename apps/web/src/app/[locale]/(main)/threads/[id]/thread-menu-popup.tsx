"use client";

import { ChartBar, Ellipsis, Pencil, Shield, Tag } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { useMenuOpening } from "@/components/ui/lazy-popup-focus";

// What the thread's "•••" menu can open: the edit dialog, or a panel under the action row.
export type ThreadPanel = "edit" | "tags" | "poll" | "moderate";

export type ThreadMenuPopupProps = {
  label: string;
  className: string;
  // In XenForo's order: edit thread, the tags, the poll, then the moderator tools.
  entries: { id: ThreadPanel; label: string }[];
  onSelect: (id: ThreadPanel) => void;
};

const ICONS = { edit: Pencil, tags: Tag, poll: ChartBar, moderate: Shield };

// The button and its menu, which Base UI draws. It is loaded when the plain button of
// `ThreadToolbar` is pressed and mounts open.
export default function ThreadMenuPopup({
  label,
  className,
  entries,
  onSelect,
  openedBy,
  openKey,
}: ThreadMenuPopupProps & OpenedProps) {
  const { defaultOpen, trigger } = useMenuOpening(openedBy, openKey);
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger
        ref={trigger}
        aria-label={label}
        className={className}
      >
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        {entries.map((entry) => {
          const Icon = ICONS[entry.id];
          return (
            <DropdownMenuItem
              key={entry.id}
              className="min-h-10 md:min-h-8"
              onClick={() => onSelect(entry.id)}
            >
              <Icon />
              {entry.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
