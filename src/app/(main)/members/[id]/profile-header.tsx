import { Ellipsis, Mail, MessagesSquare, Pencil } from "lucide-react";
import Link from "next/link";
import { FollowButton } from "@/app/(main)/members/wall-buttons";
import { ClientIcons } from "@/components/forum/client-icons";
import { RelativeTime } from "@/components/forum/relative-time";
import { SocialIcon } from "@/components/forum/social-icon";
import { StatInline } from "@/components/forum/stat";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { Container } from "@/components/layout/container";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { coverSrc, nameColor } from "@/lib/appearance";
import type { UserView } from "@/lib/db";
import { formatDate, formatNumber } from "@/lib/format";
import type { Socials } from "@/lib/types";
import { cn } from "@/lib/utils";

const SOCIALS: {
  network: keyof Socials;
  label: string;
  url: (handle: string) => string;
}[] = [
  { network: "discord", label: "Discord", url: () => "#" },
  {
    network: "telegram",
    label: "Telegram",
    url: (handle) => `https://t.me/${handle}`,
  },
  { network: "x", label: "X", url: (handle) => `https://x.com/${handle}` },
];

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
  const isOwn = viewer?.id === user.id;
  const profileHref = `/members/${user.id}`;
  const socials = SOCIALS.filter(({ network }) => user.socials[network]);
  const stats = [
    { label: "UID", value: user.id },
    { label: "Posts", value: formatNumber(user.postCount) },
    { label: "Reactions", value: formatNumber(user.reactionCount) },
    { label: "Credits", value: formatNumber(user.credits) },
    { label: "Reputation", value: formatNumber(user.reputation) },
    { label: "Vouches", value: formatNumber(user.vouches) },
  ];

  return (
    <header className="relative">
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-36 overflow-hidden bg-background md:h-56"
      >
        {user.appearance.cover && (
          <div
            className="absolute inset-0 bg-cover bg-center opacity-60"
            style={{
              backgroundImage: `url("${coverSrc(user.appearance.cover)}")`,
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/60 to-background" />
      </div>

      <Container className="relative pt-20 md:pt-44">
        <UserAvatar
          user={user}
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
                  nameColor(user.appearance.nameColor)?.text,
                )}
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
                      title={`${label}: ${handle}`}
                      aria-label={`${label}: ${handle}`}
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
                    aria-label="More"
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
                      Find all posts
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="min-h-10 md:min-h-8"
                      render={<Link href={`${profileHref}?tab=threads`} />}
                    >
                      <MessagesSquare />
                      Find all threads
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
              {user.title}
              <UserBadges user={user} />
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Joined{" "}
              <time dateTime={user.joinedAt}>{formatDate(user.joinedAt)}</time>
              <span aria-hidden="true"> · </span>
              Last seen <RelativeTime date={user.lastSeen.at} />
              <span aria-hidden="true"> · </span>
              <ClientIcons client={user.lastSeen} />
            </p>

            <p className="mt-2 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">
                {formatNumber(user.followerCount)}
              </span>{" "}
              {user.followerCount === 1 ? "Follower" : "Followers"}
              <span aria-hidden="true"> · </span>
              <span className="font-semibold text-foreground tabular-nums">
                {formatNumber(user.followingCount)}
              </span>{" "}
              Following
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
                    Edit profile
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
                      Message
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
