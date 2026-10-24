"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { ReactionPicture } from "@/components/forum/reaction-picture";
import {
  type ReactionsSummary,
  SummaryFaces,
  type SummarySize,
  summaryTriggerClass,
} from "@/components/forum/reaction-summary";
import { ReactionUsers } from "@/components/forum/reaction-users";
import type { OpenedProps } from "@/components/ui/lazy-popup";
import { usePopupFocus } from "@/components/ui/lazy-popup-focus";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";

export type ReactionSummaryPopupProps = {
  reactions: ReactionsSummary;
  members?: React.ReactNode;
  loadUsers?: () => Promise<React.ReactNode>;
  size: SummarySize;
  bar: boolean;
  className?: string;
};

// The summary's button and the popover with the counts and who reacted, which Base UI draws. It is
// loaded when the plain button of `ReactionSummary` is pressed and mounts open.
export default function ReactionSummaryPopup({
  reactions,
  loadUsers,
  members,
  size,
  bar,
  className,
  openedBy,
}: ReactionSummaryPopupProps & OpenedProps) {
  const t = useTranslations("forum.reactionSummary");
  const focus = usePopupFocus(openedBy);
  const [open, setOpen] = useState(true);
  const total = t("total", { count: reactions.total });
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={t(
          members || loadUsers ? "aria.trigger" : "aria.triggerCounts",
          { total },
        )}
        className={summaryTriggerClass(size, bar, className)}
      >
        <SummaryFaces reactions={reactions} size={size} bar={bar} />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        ref={focus.ref}
        initialFocus={focus.initialFocus}
        className="w-64 gap-0 p-0"
      >
        <PopoverTitle className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-xs text-muted-foreground">
          <span className="text-sm font-semibold text-foreground">{total}</span>
          {reactions.byType.map(({ type, count }) => (
            <span key={type.id} title={type.label} className="tabular-nums">
              <ReactionPicture emoji={type.emoji} picture={type.picture} />{" "}
              <span className="sr-only">{type.label}: </span>
              {count}
            </span>
          ))}
        </PopoverTitle>
        {members ?? (loadUsers ? <ReactionUsers load={loadUsers} /> : null)}
      </PopoverContent>
    </Popover>
  );
}
