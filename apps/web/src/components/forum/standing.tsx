import {
  Crown,
  Heart,
  type LucideIcon,
  MessageCircle,
  UserPlus,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { AwardRow } from "@/components/forum/award-icon";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { RankNumber } from "@/components/forum/leaderboard";
import { LevelBadge, XpBar } from "@/components/forum/level";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import type { MonthWinner, StandingEntry } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import {
  type Activity,
  type Month,
  POST_POINTS,
  REACTIONS_PER_POINT,
  REFERRAL_POINTS,
} from "@/lib/standing";
import { cn } from "@/lib/utils";

export function monthLabel(
  format: ReturnType<typeof useFormatter>,
  { year, month }: Month,
) {
  return format.dateTime(new Date(Date.UTC(year, month - 1, 1)), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const PARTS: {
  key: keyof Activity;
  icon: LucideIcon;
  points: (count: number) => number;
}[] = [
  {
    key: "posts",
    icon: MessageCircle,
    points: (count) => count * POST_POINTS,
  },
  {
    key: "reactions",
    icon: Heart,
    points: (count) => count / REACTIONS_PER_POINT,
  },
  {
    key: "referrals",
    icon: UserPlus,
    points: (count) => count * REFERRAL_POINTS,
  },
];

function Points({ value, className }: { value: number; className?: string }) {
  const t = useTranslations("forum.standing");
  return (
    <span className={cn("shrink-0 font-bold tabular-nums", className)}>
      {formatNumber(value)}
      <span className="text-xs font-medium text-muted-foreground">
        {" "}
        {t("pts")}
      </span>
    </span>
  );
}

// The quiet line under a name: what the points are made of.
function Breakdown({ entry }: { entry: Activity }) {
  const t = useTranslations("forum.standing.parts");
  return (
    <span className="flex flex-wrap items-center gap-x-3 text-xs tabular-nums text-muted-foreground">
      {PARTS.map(({ key, icon: Icon }) => (
        <span
          key={key}
          title={t(key)}
          className="inline-flex items-center gap-1"
        >
          <Icon aria-hidden="true" className="size-3.5" />
          <span className="sr-only">{t(key)}: </span>
          {formatNumber(entry[key])}
        </span>
      ))}
    </span>
  );
}

export function MonthHero({
  winner,
  action,
}: {
  winner: MonthWinner;
  action?: React.ReactNode;
}) {
  const t = useTranslations("forum.standing");
  const tParts = useTranslations("forum.standing.parts");
  const format = useFormatter();
  const { user } = winner;
  return (
    <section
      aria-labelledby="member-of-the-month"
      className="relative isolate overflow-hidden rounded-lg border bg-card"
    >
      <CoverBackdrop cover={user.coverPicture} className="h-44" />
      <div className="p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h2
            id="member-of-the-month"
            className="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-primary uppercase"
          >
            <Crown aria-hidden="true" className="size-4" />
            {t("heading")}
          </h2>
          <p className="text-xs font-medium text-muted-foreground">
            {monthLabel(format, winner)}
          </p>
        </div>

        <div className="mt-5 flex flex-col items-center gap-4 text-center sm:flex-row sm:gap-5 sm:text-left">
          <UserAvatar user={user.member} size="2xl" />
          <div className="min-w-0 max-w-full">
            <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 sm:justify-start">
              <UserLink
                user={user.member}
                className="max-w-full truncate text-2xl leading-10 tracking-tight"
              />
              <UserBadges user={user.member} />
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {user.member.title}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-start">
              <div className="flex items-center gap-1.5">
                <LevelBadge level={user.level} />
                <XpBar level={user.level} label className="w-20" />
              </div>
              <AwardRow
                awards={user.awards}
                max={user.awardSlots.desktop}
                maxMobile={user.awardSlots.mobile}
              />
            </div>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PARTS.map(({ key, points }) => (
            <div
              key={key}
              className="min-w-0 rounded-md border bg-background/60 p-3"
            >
              <dt className="truncate text-xs text-muted-foreground">
                {tParts(key)}
              </dt>
              <dd className="mt-1 flex flex-wrap items-baseline gap-x-2">
                <span className="text-xl leading-tight font-bold tabular-nums">
                  {formatNumber(winner[key])}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t("pointsEqual", {
                    points: formatNumber(points(winner[key])),
                  })}
                </span>
              </dd>
            </div>
          ))}
          <div className="min-w-0 rounded-md border border-primary/40 bg-primary/10 p-3">
            <dt className="truncate text-xs text-muted-foreground">
              {t("totalPoints")}
            </dt>
            <dd className="mt-1 text-xl leading-tight font-bold tabular-nums text-primary">
              {formatNumber(winner.points)}
            </dd>
          </div>
        </dl>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="text-xs text-pretty text-muted-foreground">
            {t("formula", {
              postPoints: POST_POINTS,
              reactions: REACTIONS_PER_POINT,
              referralPoints: REFERRAL_POINTS,
            })}
          </p>
          {action}
        </div>
      </div>
    </section>
  );
}

// One member's month. `label` replaces the rank with a caption above the
// name (the month, in a list of winners).
function StandingRow({
  entry,
  rank,
  label,
  leader = false,
  viewer = false,
  compact = false,
}: {
  entry: StandingEntry;
  rank?: number;
  label?: string;
  leader?: boolean;
  viewer?: boolean;
  compact?: boolean;
}) {
  return (
    <li
      className={cn(
        "flex items-center gap-3 px-4 py-2.5",
        leader && "py-4",
        viewer && "bg-primary/5",
      )}
    >
      {rank !== undefined && (
        <RankNumber rank={rank}>
          {leader && (
            <>
              <Crown aria-hidden="true" className="mx-auto size-5" />
              <span className="sr-only">{rank}</span>
            </>
          )}
        </RankNumber>
      )}
      {compact ? (
        <UserAvatar
          user={entry.user.member}
          className="relative after:absolute after:-inset-1"
        />
      ) : (
        <UserAvatar user={entry.user.member} size="lg" />
      )}
      <div className="min-w-0 flex-1">
        {label && (
          <p className="truncate text-xs font-medium text-muted-foreground">
            {label}
          </p>
        )}
        <p className="flex items-center gap-1.5">
          <UserLink
            user={entry.user.member}
            className={cn("truncate", leader ? "text-base" : "text-sm")}
          />
          <UserBadges user={entry.user.member} />
        </p>
        {!compact && <Breakdown entry={entry} />}
      </div>
      <Points
        value={entry.points}
        className={leader ? "text-xl text-primary" : "text-sm"}
      />
    </li>
  );
}

export function StandingList({
  entries,
  viewerId,
}: {
  entries: StandingEntry[];
  viewerId?: number;
}) {
  return (
    <ol className="divide-y divide-border">
      {entries.map((entry, index) => (
        <StandingRow
          key={entry.user.id}
          entry={entry}
          rank={index + 1}
          leader={index === 0}
          viewer={entry.user.id === viewerId}
        />
      ))}
    </ol>
  );
}

export function WinnerList({
  winners,
  compact,
}: {
  winners: MonthWinner[];
  compact?: boolean;
}) {
  const format = useFormatter();
  return (
    <ol className="divide-y divide-border">
      {winners.map((winner) => (
        <StandingRow
          key={`${winner.year}-${winner.month}`}
          entry={winner}
          label={monthLabel(format, winner)}
          compact={compact}
        />
      ))}
    </ol>
  );
}
