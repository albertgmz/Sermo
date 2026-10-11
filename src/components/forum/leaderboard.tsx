import {
  Coins,
  Heart,
  type LucideIcon,
  MessageCircle,
  Trophy,
  UserPlus,
} from "lucide-react";
import { LevelBadge } from "@/components/forum/level";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import type { LeaderboardKind, UserView } from "@/lib/db";
import { formatNumber } from "@/lib/format";
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
    unit: [singular: string, plural: string];
    value: (member: UserView) => number;
    accent?: boolean;
  }
> = {
  credits: {
    icon: Coins,
    unit: ["credit", "credits"],
    value: (member) => member.credits,
    accent: true,
  },
  posts: {
    icon: MessageCircle,
    unit: ["post", "posts"],
    value: (member) => member.postCount,
  },
  reactions: {
    icon: Heart,
    unit: ["reaction", "reactions"],
    value: (member) => member.reactionCount,
  },
  awards: {
    icon: Trophy,
    unit: ["award", "awards"],
    value: (member) => member.awards.length,
  },
  referrals: {
    icon: UserPlus,
    unit: ["referral", "referrals"],
    value: (member) => member.referralCount,
  },
};

function Count({ by, member }: { by: keyof typeof COUNTS; member: UserView }) {
  const { icon: Icon, unit, value, accent } = COUNTS[by];
  const count = value(member);
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold tabular-nums">
      <Icon
        aria-hidden="true"
        className={cn(
          "size-3.5",
          accent ? "text-primary" : "text-muted-foreground",
        )}
      />
      {formatNumber(count)}
      <span className="sr-only"> {unit[count === 1 ? 0 : 1]}</span>
    </span>
  );
}

export function Leaderboard({
  members,
  by,
  viewerId,
}: {
  members: UserView[];
  by: LeaderboardKind;
  viewerId?: number;
}) {
  return (
    <ol className="divide-y divide-border">
      {members.map((member, index) => (
        <li
          key={member.id}
          className={cn(
            "flex min-h-12 items-center gap-3 px-4 py-2",
            member.id === viewerId && "bg-primary/5",
          )}
        >
          <RankNumber rank={index + 1} />
          <UserAvatar
            user={member}
            className="relative after:absolute after:-inset-1"
          />
          <UserLink user={member} className="min-w-0 flex-1 truncate text-sm" />
          {by === "xp" ? (
            <>
              <LevelBadge level={member.level} />
              <span className="w-16 shrink-0 text-right text-sm font-semibold tabular-nums">
                {formatNumber(member.xp)}
                <span className="text-xs font-medium text-muted-foreground">
                  {" "}
                  XP
                </span>
              </span>
            </>
          ) : (
            <Count by={by} member={member} />
          )}
        </li>
      ))}
    </ol>
  );
}
