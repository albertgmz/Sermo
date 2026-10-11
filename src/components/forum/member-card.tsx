import { AwardRow } from "@/components/forum/award-icon";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { LevelBadge, XpBar } from "@/components/forum/level";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import type { UserView } from "@/lib/db";
import { formatCompact, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function MemberCard({
  user,
  className,
}: {
  user: UserView;
  className?: string;
}) {
  return (
    <article
      className={cn(
        "relative isolate flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 pt-8",
        className,
      )}
    >
      <CoverBackdrop cover={user.appearance.cover} variant="strip" />
      <div className="flex items-end gap-5">
        <UserAvatar user={user} size="xl" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5">
            <UserLink user={user} className="truncate text-sm" />
            <UserBadges user={user} />
          </p>
          <p className="truncate text-xs text-muted-foreground">{user.title}</p>
        </div>
      </div>
      <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-1.5">
          <LevelBadge level={user.level} />
          <XpBar level={user.level} className="w-16" />
        </div>
        {user.awards.length > 0 ? (
          <AwardRow
            awards={user.awards}
            max={user.awardSlots.desktop}
            maxMobile={user.awardSlots.mobile}
          />
        ) : (
          <span className="text-xs text-muted-foreground">No awards yet</span>
        )}
      </div>
      <dl className="mt-auto grid grid-cols-3 gap-2 border-t pt-3 text-xs">
        <div className="min-w-0">
          <dt className="text-muted-foreground">Posts</dt>
          <dd className="font-semibold tabular-nums">
            {formatCompact(user.postCount)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Reactions</dt>
          <dd className="font-semibold tabular-nums">
            {formatCompact(user.reactionCount)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">Joined</dt>
          <dd className="truncate font-semibold">
            <time dateTime={user.joinedAt}>{formatDate(user.joinedAt)}</time>
          </dd>
        </div>
      </dl>
    </article>
  );
}
