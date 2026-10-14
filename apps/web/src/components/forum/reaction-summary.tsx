import { useTranslations } from "next-intl";
import type { ReactionType } from "@/components/forum/reaction-button";
import { ReactionPicture } from "@/components/forum/reaction-picture";
import { ReactionUsers } from "@/components/forum/reaction-users";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// A summary of the reactions on one item: the counts by type and, where the list is at hand, who
// reacted.
export type ReactionsSummary = {
  total: number;
  byType: { type: ReactionType; count: number }[];
  users?: { user: MemberView; type: ReactionType }[];
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

export function ReactionSummary({
  reactions,
  loadUsers,
  size = "default",
  showTotal = true,
  className,
}: {
  // `users` when the list is at hand, `loadUsers` when it is read once the popover opens.
  reactions: ReactionsSummary;
  loadUsers?: () => Promise<React.ReactNode>;
  size?: keyof typeof SIZES;
  // False where the button beside it already shows the number.
  showTotal?: boolean;
  className?: string;
}) {
  const t = useTranslations("forum.reactionSummary");
  if (reactions.total === 0) return null;
  const total = t("total", { count: reactions.total });
  return (
    <Popover>
      <PopoverTrigger
        aria-label={t("aria.trigger", { total })}
        className={cn(
          "inline-flex h-10 items-center justify-center gap-1.5 rounded-md px-1 font-medium tabular-nums text-muted-foreground transition-colors hover:text-foreground",
          SIZES[size].trigger,
          className,
        )}
      >
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
        {showTotal && reactions.total}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-0 p-0">
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
        {reactions.users ? (
          <ul className="max-h-64 overflow-y-auto py-1">
            {reactions.users.map(({ user, type }) => (
              <li
                key={user.id}
                className="flex min-h-10 items-center gap-2 px-3 text-sm"
              >
                <UserAvatar user={user} size="sm" />
                <UserLink user={user} className="min-w-0 flex-1 truncate" />
                <span title={type.label}>
                  <ReactionPicture
                    emoji={type.emoji}
                    picture={type.picture}
                    label={type.label}
                  />
                </span>
              </li>
            ))}
          </ul>
        ) : loadUsers ? (
          <ReactionUsers load={loadUsers} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
