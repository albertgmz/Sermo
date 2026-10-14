import {
  Cake,
  Ellipsis,
  Link2,
  Mail,
  MapPin,
  MessagesSquare,
  Pencil,
} from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { CopyHandle } from "@/app/[locale]/(main)/members/[id]/copy-handle";
import type { Profile } from "@/app/[locale]/(main)/members/[id]/profile";
import { FollowButton } from "@/app/[locale]/(main)/members/wall-buttons";
import { Art } from "@/components/forum/art";
import { NameWithIcon } from "@/components/forum/name-icon";
import { RelativeTime } from "@/components/forum/relative-time";
import { type Network, SocialIcon } from "@/components/forum/social-icon";
import { StatInline } from "@/components/forum/stat";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { userNameProps } from "@/components/forum/user-name";
import { Container } from "@/components/layout/container";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDate, formatNumber } from "@/lib/format";

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
  canMessage,
}: {
  profile: Profile;
  viewerId: number | null;
  // The backend says whether the visitor may start a conversation.
  canMessage: boolean;
}) {
  const t = useTranslations("members.profileHeader");
  const format = useFormatter();
  const isOwn = viewerId === profile.id;
  const profileHref = `/members/${profile.id}`;
  const { card, birthday } = profile;
  const name = userNameProps(card);
  const socials = SOCIALS.filter(({ network }) => profile.socials[network]);
  const stats = [
    { label: t("postsLabel"), value: formatNumber(profile.postCount) },
    { label: t("reputationLabel"), value: formatNumber(profile.reactionScore) },
    { label: t("followersLabel"), value: formatNumber(profile.followerCount) },
    { label: t("followingLabel"), value: formatNumber(profile.followingCount) },
    { label: t("creditsLabel"), value: formatNumber(profile.credits) },
    { label: t("referralsLabel"), value: formatNumber(profile.referralCount) },
  ];

  return (
    <header className="relative">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-36 overflow-hidden bg-background md:h-56"
      >
        {profile.cover && (
          <Art
            category="profileCovers"
            className="absolute inset-0 bg-cover bg-center opacity-60"
            src={profile.cover.url}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/60 to-background" />
      </div>

      <Container className="relative pt-20 md:pt-44">
        <UserAvatar
          user={card}
          size="2xl"
          link={false}
          className="ring-4 ring-background"
        />

        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
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
              <span aria-hidden="true" className="h-5 w-px bg-border" />
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
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={t("aria.more")}
                    className={iconButtonClass}
                  >
                    <Ellipsis className="size-5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    <DropdownMenuItem
                      className="min-h-10 md:min-h-8"
                      render={<Link href={`${profileHref}?tab=posts`} />}
                    >
                      <MessagesSquare />
                      {t("findPosts")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="min-h-10 md:min-h-8"
                      render={<Link href={`${profileHref}?tab=threads`} />}
                    >
                      <MessagesSquare />
                      {t("findThreads")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
              {card.title}
              <UserBadges user={card} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t.rich("joined", {
                date: formatDate(profile.createdAt),
                time: (chunks) => (
                  <time dateTime={profile.createdAt}>{chunks}</time>
                ),
              })}
              {profile.lastActivityAt && (
                <>
                  <span aria-hidden="true"> · </span>
                  {t.rich("lastSeen", {
                    time: () => (
                      <RelativeTime date={profile.lastActivityAt ?? ""} />
                    ),
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
                      className="truncate font-medium text-primary underline underline-offset-4 hover:no-underline"
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
                    <FollowButton
                      user={{ id: profile.id, username: profile.username }}
                      following={profile.viewer.isFollowing}
                      returnTo={profileHref}
                      className={actionClass}
                    />
                    {canMessage && (
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
