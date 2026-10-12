import { useTranslations } from "next-intl";
import { ReactionUsers } from "@/components/forum/reaction-users";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ReactionsView } from "@/lib/db";
import { cn } from "@/lib/utils";

const TYPES_SHOWN = 3;

const SIZES = {
  default: { trigger: "text-xs", emoji: "size-5 text-xs" },
  sm: {
    trigger: "-my-1.5 min-w-10 text-(length:--text-caption) md:my-0",
    emoji: "size-4 text-(length:--text-tiny)",
  },
};

export function ReactionSummary({
  reactions,
  loadUsers,
  size = "default",
  className,
}: {
  // `users` when the list is at hand, `loadUsers` when it is read once the popover opens.
  reactions: Pick<ReactionsView, "total" | "byType"> &
    Partial<Pick<ReactionsView, "users">>;
  loadUsers?: () => Promise<React.ReactNode>;
  size?: keyof typeof SIZES;
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
          "inline-flex h-10 items-center gap-1.5 rounded-md px-1 font-medium tabular-nums text-muted-foreground transition-colors hover:text-foreground md:h-7",
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
              {type.emoji}
            </span>
          ))}
        </span>
        {reactions.total}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-0 p-0">
        <PopoverTitle className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2 text-xs text-muted-foreground">
          <span className="text-sm font-semibold text-foreground">{total}</span>
          {reactions.byType.map(({ type, count }) => (
            <span key={type.id} title={type.label} className="tabular-nums">
              <span aria-hidden="true">{type.emoji}</span>{" "}
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
                <UserAvatar user={user.member} size="sm" />
                <UserLink
                  user={user.member}
                  className="min-w-0 flex-1 truncate"
                />
                <span role="img" aria-label={type.label} title={type.label}>
                  {type.emoji}
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
