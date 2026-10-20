import {
  Coins,
  Heart,
  type LucideIcon,
  MessageCircle,
  Trophy,
  UserPlus,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { LevelBadge } from "@/components/forum/level";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { formatCompact, formatCredits, formatNumber } from "@/lib/format";
import type { MemberView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

export type LeaderboardKind =
  | "credits"
  | "posts"
  | "reactions"
  | "awards"
  | "referrals"
  | "xp";

// A member in a ranking and the numbers any ranking may show: an item of the members list.
export type LeaderboardMember = {
  card: MemberView;
  awardXp: number;
  credits: number;
  postCount: number;
  reactionScore: number;
  referralCount: number;
  awardCount: number;
};

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
    value: (member: LeaderboardMember) => number;
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
    value: (member) => member.reactionScore,
  },
  awards: {
    icon: Trophy,
    value: (member) => member.awardCount,
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
  member: LeaderboardMember;
  compact?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("forum.leaderboard");
  if (by === "xp") {
    return (
      <span className="inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1">
        <LevelBadge level={member.card} />
        <span
          title={t("xpTitle", { xp: formatNumber(member.awardXp, locale) })}
          className="whitespace-nowrap text-sm font-semibold tabular-nums"
        >
          {compact
            ? formatCompact(member.awardXp, locale)
            : formatNumber(member.awardXp, locale)}
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
      title={t(`titles.${by}`, {
        count,
        amount: formatCredits(count, locale),
      })}
      className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold tabular-nums"
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3.5",
          accent ? "text-primary-ink" : "text-muted-foreground",
        )}
      />
      {compact
        ? formatCompact(count, locale)
        : (by === "credits" ? formatCredits : formatNumber)(count, locale)}
      <span className="sr-only"> {t(`aria.units.${by}`, { count })}</span>
    </span>
  );
}

// One member of a ranking: rank, avatar, name and the score. A list draws it inside an item of its
// own (`Leaderboard`, or the infinite list of a long ranking).
export function LeaderboardRow({
  member,
  by,
  viewerId,
  rank,
  compact = false,
}: {
  member: LeaderboardMember;
  by: LeaderboardKind;
  viewerId?: number;
  rank: number;
  compact?: boolean;
}) {
  const locale = useLocale();
  const t = useTranslations("forum.leaderboard");
  return (
    <div
      className={cn(
        "flex min-h-12 items-center gap-3 px-4 py-2",
        compact && "min-h-10 gap-2 px-3 py-0",
        member.card.id === viewerId && "bg-primary/5",
      )}
    >
      <RankNumber rank={rank} />
      <UserAvatar
        user={member.card}
        className="relative after:absolute after:-inset-1"
      />
      <UserLink
        user={member.card}
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          compact && "min-h-10 content-center",
        )}
      />
      {by === "xp" && !compact ? (
        <>
          <LevelBadge level={member.card} />
          <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
            {formatNumber(member.awardXp, locale)}
            <span className="text-xs font-medium text-muted-foreground">
              {" "}
              {t("xp")}
            </span>
          </span>
        </>
      ) : (
        <LeaderboardScore by={by} member={member} compact={compact} />
      )}
    </div>
  );
}

export function Leaderboard({
  members,
  by,
  viewerId,
  start = 1,
  compact = false,
}: {
  members: LeaderboardMember[];
  by: LeaderboardKind;
  viewerId?: number;
  start?: number;
  compact?: boolean;
}) {
  return (
    <ol start={start} className="divide-y divide-border">
      {members.map((member, index) => (
        <li key={member.card.id}>
          <LeaderboardRow
            member={member}
            by={by}
            viewerId={viewerId}
            rank={start + index}
            compact={compact}
          />
        </li>
      ))}
    </ol>
  );
}
