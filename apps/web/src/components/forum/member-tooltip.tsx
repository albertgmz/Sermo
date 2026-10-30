import { useLocale, useTranslations } from "next-intl";
import { ActivityLine } from "@/components/forum/activity-line";
import { AwardRow } from "@/components/forum/award-icon";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { DeviceIcons } from "@/components/forum/device-icons";
import { LevelBadge } from "@/components/forum/level";
import { MemberCardProfileLink } from "@/components/forum/member-card-profile-link";
import { StaticRelativeTime } from "@/components/forum/relative-time-static";
import { UserAvatar } from "@/components/forum/user-avatar";
import { titleBesideBadges, UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import { formatNumber } from "@/lib/format";
import type { AuthorView } from "@/lib/sermo/views";

// The member's card, laid out as XenForo's member tooltip: a header with the avatar on the left and,
// beside it, the name, the badges and level, the title, the awards, when they joined, when they
// were last seen (and, within the hour, where) and the device they last signed in from; then a row of counts, then the viewer's actions and the way to the profile. The
// cover lies behind the header. `actions` is drawn first on the last line.
export function MemberTooltip({
  author,
  actions,
}: {
  author: AuthorView;
  actions?: React.ReactNode;
}) {
  const locale = useLocale();
  const t = useTranslations("forum.memberCard");
  const { member, lastActivity } = author;
  const title = titleBesideBadges(member);
  const joined = Number.isFinite(new Date(author.joinedAt).getTime());
  return (
    <article data-slot="member-tooltip" className="flex min-w-0 flex-col">
      <div className="relative isolate flex gap-3 p-3">
        <CoverBackdrop
          cover={author.cover}
          variant="strip"
          className="h-full"
        />
        <UserAvatar user={member} size="xl" className="self-start" />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <p className="max-w-full text-lg leading-tight">
            <UserLink user={member} wrap className="[overflow-wrap:anywhere]" />
          </p>
          <div className="flex max-w-full flex-wrap items-center gap-1 [&>*]:max-w-full">
            <UserBadges user={member} />
            <LevelBadge level={member} />
          </div>
          {title && (
            <p className="max-w-full text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {title}
            </p>
          )}
          <AwardRow awards={author.awards} />
          <dl className="grid gap-0.5 text-xs">
            {joined && (
              <Pair label={t("registeredLabel")}>
                <StaticRelativeTime date={author.joinedAt} />
              </Pair>
            )}
            {lastActivity && (
              <Pair label={t("lastSeenLabel")}>
                <ActivityLine activity={lastActivity} />
              </Pair>
            )}
            {author.device && (
              <Pair label={t("deviceLabel")}>
                <DeviceIcons device={author.device} />
              </Pair>
            )}
          </dl>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-2 border-t px-3 py-2 text-center">
        <Count label={t("postsLabel")}>
          {formatNumber(author.postCount, locale)}
        </Count>
        <Count label={t("reactionsLabel")}>
          {formatNumber(author.reactionScore, locale)}
        </Count>
        <Count label={t("pointsLabel")} title={t("pointsTitle")}>
          {formatNumber(author.xp, locale)}
        </Count>
      </dl>
      <div className="flex flex-wrap items-center gap-1.5 border-t p-3">
        {actions}
        <MemberCardProfileLink id={member.id} />
      </div>
    </article>
  );
}

// "Label: value" on one line, as XenForo's inline pairs.
function Pair({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap gap-x-1">
      <dt className="text-muted-foreground after:content-[':']">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// A label over its figure, centred in its third of the row.
function Count({
  label,
  title,
  children,
}: {
  label: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt title={title} className="truncate text-xs text-muted-foreground">
        {label}
      </dt>
      <dd className="truncate font-semibold tabular-nums">{children}</dd>
    </div>
  );
}
