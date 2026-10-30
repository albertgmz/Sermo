import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  type AwardArt,
  AwardRow,
  DESKTOP_AWARD_SLOTS,
  MOBILE_AWARD_SLOTS,
} from "@/components/forum/award-icon";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { LevelBadge, levelWithBounds, XpBar } from "@/components/forum/level";
import { MemberCardScope } from "@/components/forum/member-card-scope";
import { NameWithIcon } from "@/components/forum/name-icon";
import { StaticRelativeTime } from "@/components/forum/relative-time-static";
import { UserAvatar } from "@/components/forum/user-avatar";
import { titleBesideBadges, UserBadges } from "@/components/forum/user-badges";
import { userNameProps } from "@/components/forum/user-name";
import { buttonVariants } from "@/components/ui/button";
import { formatCompact } from "@/lib/format";
import type { MemberView, PictureView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

// A member as the members list and a profile answer: the list item carries the counts only, the
// profile adds the cover, the bounds of the level and the number of award slots.
export type MemberCardUser = {
  card: MemberView;
  createdAt: string;
  postCount: number;
  reactionScore: number;
  // Where the awards themselves are not at hand, only how many there are.
  awardCount?: number;
  awards?: (AwardArt & { id: number })[];
  awardSlots?: number;
  cover?: PictureView | null;
  // The bar needs the bounds of the level; without them the badge stands alone.
  awardXp?: number;
  level?: { currentLevelXp: number; nextLevelXp: number };
};

// What the card of a member shows when the profile cannot be opened: the name and nothing else.
export function MemberCardMinimal({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "p-4 text-sm font-semibold [overflow-wrap:anywhere]",
        className,
      )}
    >
      {name}
    </p>
  );
}

export function MemberCard({
  user,
  className,
}: {
  user: MemberCardUser;
  className?: string;
}) {
  const locale = useLocale();
  const t = useTranslations("forum.memberCard");
  const name = userNameProps(user.card);
  const awards = user.awards ?? [];
  const slots = user.awardSlots ?? DESKTOP_AWARD_SLOTS;
  return (
    <MemberCardScope disabled>
      <article
        className={cn(
          "relative isolate flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4 pt-8",
          className,
        )}
      >
        <CoverBackdrop cover={user.cover ?? null} variant="strip" />
        <div className="flex items-end gap-5">
          <UserAvatar user={user.card} size="xl" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  "max-w-full truncate text-sm font-semibold",
                  name.className,
                )}
                style={name.style}
              >
                <NameWithIcon user={user.card} />
              </span>
              <UserBadges user={user.card} />
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {titleBesideBadges(user.card)}
            </p>
          </div>
        </div>
        <div className="flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-1.5">
            <LevelBadge level={user.card} />
            {user.level && user.awardXp !== undefined && (
              <XpBar
                level={levelWithBounds(
                  user.card.level,
                  user.awardXp,
                  user.level.currentLevelXp,
                  user.level.nextLevelXp,
                )}
                className="w-16"
              />
            )}
          </div>
          {awards.length > 0 ? (
            <AwardRow
              awards={awards}
              max={slots}
              maxMobile={Math.min(slots, MOBILE_AWARD_SLOTS)}
              className="min-h-10 min-w-10 after:hidden"
            />
          ) : (
            <span className="text-xs text-muted-foreground">
              {user.awardCount
                ? t("awardCount", { count: user.awardCount })
                : t("emptyAwards")}
            </span>
          )}
        </div>
        <dl className="mt-auto grid grid-cols-3 gap-2 border-t pt-3 text-xs">
          <div className="min-w-0">
            <dt className="text-muted-foreground">{t("postsLabel")}</dt>
            <dd className="font-semibold tabular-nums">
              {formatCompact(user.postCount, locale)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">{t("reactionsLabel")}</dt>
            <dd className="font-semibold tabular-nums">
              {formatCompact(user.reactionScore, locale)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">{t("joinedLabel")}</dt>
            <dd className="truncate font-semibold">
              <StaticRelativeTime date={user.createdAt} />
            </dd>
          </div>
        </dl>
        <Link
          href={`/members/${user.card.id}`}
          className={cn(
            buttonVariants({ variant: "outline" }),
            "min-h-10 w-full",
          )}
        >
          {t("profile")}
        </Link>
      </article>
    </MemberCardScope>
  );
}
