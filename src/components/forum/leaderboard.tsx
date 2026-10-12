import {
  Coins,
  Heart,
  type LucideIcon,
  MessageCircle,
  Trophy,
  UserPlus,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { LevelBadge } from "@/components/forum/level";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import type { LeaderboardKind, UserView } from "@/lib/db";
import { formatCompact, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const MEDAL_CLASSES = [
  "text-tier-gold",
  "text-tier-silver",
  "text-tier-bronze",
];

// The position in a ranked list. The first three get a medal colour unless
// the list is not a competition.
export function RankNumber({
  rank,
  medal = true,
  children,
}: {
  rank: number;
  medal?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "w-5 shrink-0 text-center text-sm font-bold tabular-nums",
        (medal && MEDAL_CLASSES[rank - 1]) || "text-muted-foreground",
      )}
    >
      {children ?? rank}
    </span>
  );
}

const COUNTS: Record<
  Exclude<LeaderboardKind, "xp">,
  {
    icon: LucideIcon;
    value: (member: UserView) => number;
    accent?: boolean;
  }
> = {
  credits: {
    icon: Coins,
    value: (member) => member.credits,
    accent: true,
  },
  posts: {
    icon: MessageCircle,
    value: (member) => member.postCount,
  },
  reactions: {
    icon: Heart,
    value: (member) => member.reactionCount,
  },
  awards: {
    icon: Trophy,
    value: (member) => member.awards.length,
  },
  referrals: {
    icon: UserPlus,
    value: (member) => member.referralCount,
  },
};

export function LeaderboardScore({
  by,
  member,
  compact = false,
}: {
  by: LeaderboardKind;
  member: UserView;
  compact?: boolean;
}) {
  const t = useTranslations("forum.leaderboard");
  if (by === "xp") {
    return (
      <span className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <LevelBadge level={member.level} />
        <span
          title={t("xpTitle", { xp: formatNumber(member.xp) })}
          className="whitespace-nowrap text-sm font-semibold tabular-nums"
        >
          {compact ? formatCompact(member.xp) : formatNumber(member.xp)}
          <span className="text-xs font-medium text-muted-foreground">
            {" "}
            {t("xp")}
          </span>
        </span>
      </span>
    );
  }

  const { icon: Icon, value, accent } = COUNTS[by];
  const count = value(member);
  return (
    <span
      title={t(`titles.${by}`, { count })}
      className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold tabular-nums"
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3.5",
          accent ? "text-primary" : "text-muted-foreground",
        )}
      />
      {compact ? formatCompact(count) : formatNumber(count)}
      <span className="sr-only"> {t(`aria.units.${by}`, { count })}</span>
    </span>
  );
}

export function Leaderboard({
  members,
  by,
  viewerId,
  start = 1,
  compact = false,
}: {
  members: UserView[];
  by: LeaderboardKind;
  viewerId?: number;
  start?: number;
  compact?: boolean;
}) {
  const t = useTranslations("forum.leaderboard");
  return (
    <ol start={start} className="divide-y divide-border">
      {members.map((member, index) => (
        <li
          key={member.id}
          className={cn(
            "flex min-h-12 items-center gap-3 px-4 py-2",
            compact && "min-h-10 gap-2 px-3 py-0",
            member.id === viewerId && "bg-primary/5",
          )}
        >
          <RankNumber rank={start + index} />
          <UserAvatar
            user={member}
            className="relative after:absolute after:-inset-1"
          />
          <UserLink
            user={member}
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              compact && "min-h-10 content-center",
            )}
          />
          {by === "xp" && !compact ? (
            <>
              <LevelBadge level={member.level} />
              <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
                {formatNumber(member.xp)}
                <span className="text-xs font-medium text-muted-foreground">
                  {" "}
                  {t("xp")}
                </span>
              </span>
            </>
          ) : (
            <LeaderboardScore by={by} member={member} compact={compact} />
          )}
        </li>
      ))}
    </ol>
  );
}
