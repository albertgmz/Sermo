import { Cake, Link2, Mail, MapPin, Pencil } from "lucide-react";
import Link from "next/link";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { blockFromPage } from "@/app/[locale]/(main)/actions";
import { CopyHandle } from "@/app/[locale]/(main)/members/[id]/copy-handle";
import type { Profile } from "@/app/[locale]/(main)/members/[id]/profile";
import { ProfileMore } from "@/app/[locale]/(main)/members/[id]/profile-more";
import { FollowButton } from "@/app/[locale]/(main)/members/wall-buttons";
import { ActivityLine } from "@/components/forum/activity-line";
import { AdultBadge } from "@/components/forum/adult-badge";
import { Art } from "@/components/forum/art";
import { MemberBlockButton } from "@/components/forum/member-follow-button";
import { NameWithIcon } from "@/components/forum/name-icon";
import { type Network, SocialIcon } from "@/components/forum/social-icon";
import { StatInline } from "@/components/forum/stat";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { userNameProps } from "@/components/forum/user-name";
import { Container } from "@/components/layout/container";
import { buttonVariants } from "@/components/ui/button";
import { formatCredits, formatDate, formatNumber } from "@/lib/format";
import type { MemberRelation } from "@/lib/sermo/members";

import type { ActivityView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

const SOCIALS = [
  // A Discord name is not an address: there is nothing to open, so it is copied instead.
  { network: "discord", label: "discordLabel", url: () => null },
  {
    network: "telegram",
    label: "telegramLabel",
    url: (handle) => `https://t.me/${encodeURIComponent(handle)}`,
  },
  {
    network: "x",
    label: "xLabel",
    url: (handle) => `https://x.com/${encodeURIComponent(handle)}`,
  },
] as const satisfies readonly {
  network: Network;
  label: string;
  url: (handle: string) => string | null;
}[];

const iconButtonClass =
  "inline-flex size-10 items-center justify-center rounded-md text-foreground/80 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:size-8";

const actionClass = "h-10 px-4 md:h-8 md:px-3";

export function ProfileHeader({
  profile,
  viewerId,
  relation,
  activity,
  adult = false,
}: {
  profile: Profile;
  viewerId: number | null;
  // What the visitor may do about the member (`users.relations`): follow, start a conversation,
  // block. Null for a guest, or when the backend did not answer.
  relation: MemberRelation | null;
  // When the member was last active and, within the hour, where (`users.activity`); without it
  // the profile's own time is shown alone.
  activity?: ActivityView | null;
  // The profile carries the +18 mark (the site's +18 mode is on).
  adult?: boolean;
}) {
  const lastSeen =
    activity ??
    (profile.lastActivityAt
      ? { at: profile.lastActivityAt, hidden: false, place: null }
      : null);
  const locale = useLocale();
  const t = useTranslations("members.profileHeader");
  const format = useFormatter();
  const isOwn = viewerId === profile.id;
  const profileHref = `/members/${profile.id}`;
  const { card, birthday } = profile;
  const name = userNameProps(card);
  const socials = SOCIALS.filter(({ network }) => profile.socials[network]);
  const stats = [
    { label: t("postsLabel"), value: formatNumber(profile.postCount, locale) },
    {
      label: t("reputationLabel"),
      value: formatNumber(profile.reactionScore, locale),
    },
    {
      label: t("followersLabel"),
      value: formatNumber(profile.followerCount, locale),
    },
    {
      label: t("followingLabel"),
      value: formatNumber(profile.followingCount, locale),
    },
    { label: t("creditsLabel"), value: formatCredits(profile.credits, locale) },
    {
      label: t("referralsLabel"),
      value: formatNumber(profile.referralCount, locale),
    },
  ];

  // With a cover the avatar overlaps its foot; without one there is no band: the avatar sits at the
  // top, beside the name from `md`.
  const covered = profile.cover !== null;
  return (
    <header className="relative">
      {profile.cover && (
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-36 overflow-hidden bg-background md:h-56"
        >
          <Art
            category="profileCovers"
            className="absolute inset-0 bg-cover bg-center opacity-60"
            src={profile.cover.url}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/60 to-background" />
        </div>
      )}

      <Container
        className={cn(
          "relative",
          covered
            ? "pt-20 md:pt-44"
            : "flex flex-col gap-3 pt-4 md:flex-row md:items-start md:gap-6 md:pt-6",
        )}
      >
        <UserAvatar
          user={card}
          size="2xl"
          link={false}
          eager
          className="shrink-0 ring-4 ring-background"
        />

        <div
          className={cn(
            "flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-8",
            covered ? "mt-3" : "md:min-w-0 md:flex-1",
          )}
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3">
              <h1
                className={cn(
                  "max-w-full min-w-0 text-2xl leading-10 font-bold tracking-tight [overflow-wrap:anywhere]",
                  name.className,
                )}
                style={name.style}
              >
                <NameWithIcon user={card} wrap>
                  {profile.username}
                </NameWithIcon>
              </h1>
              {adult && <AdultBadge className="h-6" />}
              {socials.length > 0 && (
                <span aria-hidden="true" className="h-5 w-px bg-border" />
              )}
              <div className="-ml-2 flex items-center md:ml-0 md:gap-1">
                {socials.map(({ network, label, url }) => {
                  const handle = profile.socials[network];
                  const href = url(handle);
                  const networkName = t(label);
                  if (href === null) {
                    return (
                      <CopyHandle
                        key={network}
                        handle={handle}
                        label={t("copyHandle", {
                          network: networkName,
                          handle,
                        })}
                        copiedLabel={t("handleCopied")}
                        className={iconButtonClass}
                      >
                        <SocialIcon network={network} className="size-5" />
                      </CopyHandle>
                    );
                  }
                  return (
                    <Link
                      key={network}
                      href={href}
                      title={t("social", { network: networkName, handle })}
                      aria-label={t("social", { network: networkName, handle })}
                      className={iconButtonClass}
                      target="_blank"
                      rel="noreferrer nofollow"
                    >
                      <SocialIcon network={network} className="size-5" />
                    </Link>
                  );
                })}
                <ProfileMore
                  label={t("aria.more")}
                  className={iconButtonClass}
                  profileHref={profileHref}
                  findPosts={t("findPosts")}
                  findThreads={t("findThreads")}
                />
              </div>
            </div>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
              {card.title}
              <UserBadges user={card} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t.rich("joined", {
                date: formatDate(profile.createdAt, locale),
                time: (chunks) => (
                  <time dateTime={profile.createdAt}>{chunks}</time>
                ),
              })}
              {lastSeen && (
                <>
                  <span aria-hidden="true"> · </span>
                  {t.rich("lastSeen", {
                    time: () => <ActivityLine activity={lastSeen} />,
                  })}
                </>
              )}
            </p>
            {(profile.location || profile.website || birthday) && (
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {profile.location && (
                  <li className="inline-flex items-center gap-1.5 [overflow-wrap:anywhere]">
                    <MapPin aria-hidden="true" className="size-4 shrink-0" />
                    {profile.location}
                  </li>
                )}
                {profile.website && (
                  <li className="inline-flex min-w-0 items-center gap-1.5">
                    <Link2 aria-hidden="true" className="size-4 shrink-0" />
                    <a
                      href={profile.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate font-medium text-primary-ink underline underline-offset-4 hover:no-underline"
                    >
                      {profile.website.replace(/^https?:\/\//, "")}
                    </a>
                  </li>
                )}
                {birthday && (
                  <li className="inline-flex items-center gap-1.5">
                    <Cake aria-hidden="true" className="size-4 shrink-0" />
                    {t("birthday", {
                      date: format.dateTime(
                        new Date(
                          Date.UTC(2000, birthday.month - 1, birthday.day),
                        ),
                        { day: "numeric", month: "long", timeZone: "UTC" },
                      ),
                    })}
                  </li>
                )}
              </ul>
            )}

            {viewerId !== null && (
              <div className="mt-3 flex flex-wrap gap-2">
                {isOwn ? (
                  <Link
                    href="/account"
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      actionClass,
                    )}
                  >
                    <Pencil />
                    {t("editProfile")}
                  </Link>
                ) : (
                  <>
                    {(!relation ||
                      relation.canFollow ||
                      profile.viewer.isFollowing) && (
                      <FollowButton
                        user={{ id: profile.id, username: profile.username }}
                        following={profile.viewer.isFollowing}
                        returnTo={profileHref}
                        className={actionClass}
                      />
                    )}
                    {/* Follow, block, then the message: the order of the member card. */}
                    {(relation?.canBlock || profile.viewer.isBlocking) && (
                      <MemberBlockButton
                        userId={profile.id}
                        username={profile.username}
                        blocking={profile.viewer.isBlocking}
                        action={blockFromPage.bind(null, profile.id)}
                        className={actionClass}
                        errorClassName="basis-full"
                      />
                    )}
                    {relation?.canMessage && (
                      <Link
                        href={`/conversations/new?to=${encodeURIComponent(profile.username)}`}
                        className={cn(
                          buttonVariants({ variant: "outline" }),
                          actionClass,
                        )}
                      >
                        <Mail />
                        {t("message")}
                      </Link>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-x-4 gap-y-3 rounded-lg border bg-card p-3 lg:flex lg:shrink-0 lg:gap-6 lg:border-0 lg:bg-transparent lg:p-0">
            {stats.map((stat) => (
              <StatInline
                key={stat.label}
                label={stat.label}
                value={stat.value}
                className="min-w-0"
              />
            ))}
          </div>
        </div>
      </Container>
    </header>
  );
}
