import Link from "next/link";
import { useTranslations } from "next-intl";
import { AwardRow } from "@/components/forum/award-icon";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { LevelBadge, XpBar } from "@/components/forum/level";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { userNameClass } from "@/components/forum/user-name";
import { buttonVariants } from "@/components/ui/button";
import type { UserView } from "@/lib/db";
import { formatCompact, formatDate } from "@/lib/format";
import { titleKeyForLevel } from "@/lib/levels";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";

export type MemberCardUser = Pick<
  UserView,
  | "id"
  | "username"
  | "avatar"
  | "appearance"
  | "customTitle"
  | "permissions"
  | "role"
  | "rank"
  | "donor"
  | "level"
  | "awards"
  | "awardSlots"
  | "postCount"
  | "reactionCount"
  | "joinedAt"
>;

export function MemberCard({
  user,
  className,
}: {
  user: MemberCardUser;
  className?: string;
}) {
  const t = useTranslations("forum.memberCard");
  const tLevels = useTranslations("lib.levels");
  const tRoles = useTranslations("lib.db.roles");
  const title =
    (can(user, "customTitle") && user.customTitle) ||
    (user.role === "member"
      ? tLevels(titleKeyForLevel(user.level.level))
      : tRoles(user.role));
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
          <p className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "max-w-full truncate text-sm font-semibold",
                userNameClass(user),
              )}
            >
              {user.username}
            </span>
            <UserBadges user={user} />
          </p>
          <p className="truncate text-xs text-muted-foreground">{title}</p>
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
            className="min-h-10 min-w-10 after:hidden"
          />
        ) : (
          <span className="text-xs text-muted-foreground">{t("emptyAwards")}</span>
        )}
      </div>
      <dl className="mt-auto grid grid-cols-3 gap-2 border-t pt-3 text-xs">
        <div className="min-w-0">
          <dt className="text-muted-foreground">{t("postsLabel")}</dt>
          <dd className="font-semibold tabular-nums">
            {formatCompact(user.postCount)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">{t("reactionsLabel")}</dt>
          <dd className="font-semibold tabular-nums">
            {formatCompact(user.reactionCount)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">{t("joinedLabel")}</dt>
          <dd className="truncate font-semibold">
            <time dateTime={user.joinedAt}>{formatDate(user.joinedAt)}</time>
          </dd>
        </div>
      </dl>
      <Link
        href={`/members/${user.id}`}
        className={cn(
          buttonVariants({ variant: "outline" }),
          "min-h-10 w-full",
        )}
      >
        {t("profile")}
      </Link>
    </article>
  );
}
