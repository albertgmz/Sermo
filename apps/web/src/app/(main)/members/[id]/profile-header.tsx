import { Ellipsis, Mail, MessagesSquare, Pencil } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { FollowButton } from "@/app/(main)/members/wall-buttons";
import { Art } from "@/components/forum/art";
import { ClientIcons } from "@/components/forum/client-icons";
import { RelativeTime } from "@/components/forum/relative-time";
import { SocialIcon } from "@/components/forum/social-icon";
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
import type { UserView } from "@/lib/db";
import { formatDate, formatNumber } from "@/lib/format";
import { nameColorHex } from "@/lib/legacy-views";
import { titleKeyForLevel } from "@/lib/levels";
import { can } from "@/lib/permissions";
import type { Socials } from "@/lib/types";
import { cn } from "@/lib/utils";

const SOCIALS = [
  { network: "discord", label: "discordLabel", url: () => "#" },
  {
    network: "telegram",
    label: "telegramLabel",
    url: (handle) => `https://t.me/${handle}`,
  },
  { network: "x", label: "xLabel", url: (handle) => `https://x.com/${handle}` },
] as const satisfies readonly {
  network: keyof Socials;
  label: string;
  url: (handle: string) => string;
}[];

const iconButtonClass =
  "inline-flex size-10 items-center justify-center rounded-md text-foreground/80 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:size-8";

const actionClass = "h-10 px-4 md:h-8 md:px-3";

export function ProfileHeader({
  user,
  viewer,
  following,
}: {
  user: UserView;
  viewer: UserView | null;
  following: boolean;
}) {
  const t = useTranslations("members.profileHeader");
  const levels = useTranslations("lib.levels");
  const roles = useTranslations("lib.db.roles");
  const isOwn = viewer?.id === user.id;
  const profileHref = `/members/${user.id}`;
  const name = userNameProps({
    nameColor: nameColorHex(user.appearance.nameColor),
  });
  const socials = SOCIALS.filter(({ network }) => user.socials[network]);
  const stats = [
    { label: t("uidLabel"), value: user.id },
    { label: t("postsLabel"), value: formatNumber(user.postCount) },
    { label: t("reactionsLabel"), value: formatNumber(user.reactionCount) },
    { label: t("creditsLabel"), value: formatNumber(user.credits) },
    { label: t("reputationLabel"), value: formatNumber(user.reputation) },
    { label: t("vouchesLabel"), value: formatNumber(user.vouches) },
  ];

  return (
    <header className="relative">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-36 overflow-hidden bg-background md:h-56"
      >
        {user.coverPicture && (
          <Art
            category="profileCovers"
            className="absolute inset-0 bg-cover bg-center opacity-60"
            src={user.coverPicture.url}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/60 to-background" />
      </div>

      <Container className="relative pt-20 md:pt-44">
        <UserAvatar
          user={user.member}
          size="2xl"
          link={false}
          className="ring-4 ring-background"
        />

        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3">
              <h1
                className={cn(
                  "text-2xl leading-10 font-bold tracking-tight [overflow-wrap:anywhere]",
                  name.className,
                )}
                style={name.style}
              >
                {user.username}
              </h1>
              <span aria-hidden="true" className="h-5 w-px bg-border" />
              <div className="-ml-2 flex items-center md:ml-0 md:gap-1">
                {socials.map(({ network, label, url }) => {
                  const handle = user.socials[network] as string;
                  const href = url(handle);
                  return (
                    <Link
                      key={network}
                      href={href}
                      title={t("social", { network: t(label), handle })}
                      aria-label={t("social", { network: t(label), handle })}
                      className={iconButtonClass}
                      {...(href === "#"
                        ? {}
                        : { target: "_blank", rel: "noreferrer nofollow" })}
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
              {can(user, "customTitle") && user.customTitle
                ? user.customTitle
                : user.role === "member"
                  ? levels(titleKeyForLevel(user.level.level))
                  : roles(user.role)}
              <UserBadges user={user.member} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t.rich("joined", {
                date: formatDate(user.joinedAt),
                time: (chunks) => (
                  <time dateTime={user.joinedAt}>{chunks}</time>
                ),
              })}
              <span aria-hidden="true"> · </span>
              {t.rich("lastSeen", {
                time: () => <RelativeTime date={user.lastSeen.at} />,
              })}
              <span aria-hidden="true"> · </span>
              <ClientIcons client={user.lastSeen} />
            </p>

            <p className="mt-2 text-sm text-muted-foreground">
              {t.rich("followers", {
                count: user.followerCount,
                value: (chunks) => (
                  <span className="font-semibold text-foreground tabular-nums">
                    {chunks}
                  </span>
                ),
              })}
              <span aria-hidden="true"> · </span>
              {t.rich("following", {
                count: user.followingCount,
                value: (chunks) => (
                  <span className="font-semibold text-foreground tabular-nums">
                    {chunks}
                  </span>
                ),
              })}
            </p>

            {viewer && (
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
                      user={user}
                      viewer={viewer}
                      following={following}
                      className={actionClass}
                    />
                    <Link
                      href={`/conversations/new?to=${encodeURIComponent(user.username)}`}
                      className={cn(
                        buttonVariants({ variant: "outline" }),
                        actionClass,
                      )}
                    >
                      <Mail />
                      {t("message")}
                    </Link>
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
