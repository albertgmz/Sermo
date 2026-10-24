"use client";

import { useTranslations } from "next-intl";
import type { ReactionType } from "@/components/forum/reaction-button";
import { ReactionPicture } from "@/components/forum/reaction-picture";
import type { ReactionSummaryPopupProps } from "@/components/forum/reaction-summary-popup";
import { LazyPopup } from "@/components/ui/lazy-popup";
import { cn } from "@/lib/utils";

// A summary of the reactions on one item: the counts by type.
export type ReactionsSummary = {
  total: number;
  byType: { type: ReactionType; count: number }[];
};

const TYPES_SHOWN = 3;

const SIZES = {
  default: {
    trigger: "min-w-10 text-xs md:h-8 md:min-w-8",
    emoji: "size-5 text-xs",
  },
  sm: {
    trigger: "min-w-10 text-(length:--text-caption) md:h-7 md:min-w-7",
    emoji: "size-4 text-(length:--text-tiny)",
  },
};

export type SummarySize = keyof typeof SIZES;

// The summary's button, the same plain or inside the popover: the faces of the first types and the
// total. Inline (beside the react button of a feed card) it is a compact pill with the number;
// under an item's bar (`bar`) it is XenForo's reactions bar, a row across the item with the total
// in words, whose ground the bar's place gives it.
export const summaryTriggerClass = (
  size: SummarySize,
  bar: boolean,
  className?: string,
) =>
  cn(
    "items-center gap-1.5 rounded-md font-medium tabular-nums text-muted-foreground transition-colors hover:text-foreground",
    bar
      ? "flex min-h-10 w-full justify-start px-2 text-left text-xs md:min-h-8"
      : cn("inline-flex h-10 justify-center px-1", SIZES[size].trigger),
    className,
  );

export function SummaryFaces({
  reactions,
  size,
  bar,
}: {
  reactions: ReactionsSummary;
  size: SummarySize;
  bar: boolean;
}) {
  const t = useTranslations("forum.reactionSummary");
  return (
    <>
      <span aria-hidden="true" className="flex -space-x-1">
        {reactions.byType.slice(0, TYPES_SHOWN).map(({ type }) => (
          <span
            key={type.id}
            className={cn(
              "flex items-center justify-center rounded-full bg-muted leading-none ring-2 ring-card",
              SIZES[size].emoji,
            )}
          >
            <ReactionPicture emoji={type.emoji} picture={type.picture} />
          </span>
        ))}
      </span>
      {bar ? (
        <span className="min-w-0 truncate">
          {t("total", { count: reactions.total })}
        </span>
      ) : (
        reactions.total
      )}
    </>
  );
}

// The popover's code (Base UI) is fetched when the button is first reached for; until then it is a
// plain one.
const loadPopup = () => import("@/components/forum/reaction-summary-popup");

export function ReactionSummary({
  reactions,
  loadUsers,
  members,
  size = "default",
  bar = false,
  className,
}: {
  reactions: ReactionsSummary;
  // Who reacted: the list itself (a `ReactionMemberList`) when it is at hand, `loadUsers` when it
  // is read once the popover opens.
  members?: React.ReactNode;
  loadUsers?: () => Promise<React.ReactNode>;
  size?: SummarySize;
  // Under an item's bar of actions rather than beside its react button.
  bar?: boolean;
  className?: string;
}) {
  const t = useTranslations("forum.reactionSummary");
  if (reactions.total === 0) return null;
  const popup: ReactionSummaryPopupProps = {
    reactions,
    loadUsers,
    members,
    size,
    bar,
    className,
  };
  return (
    <LazyPopup
      load={loadPopup}
      popup={popup}
      trigger={(lazy) => (
        <button
          type="button"
          data-slot="popover-trigger"
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-label={t(
            members || loadUsers ? "aria.trigger" : "aria.triggerCounts",
            { total: t("total", { count: reactions.total }) },
          )}
          className={summaryTriggerClass(size, bar, className)}
          {...lazy}
        >
          <SummaryFaces reactions={reactions} size={size} bar={bar} />
        </button>
      )}
    />
  );
}
