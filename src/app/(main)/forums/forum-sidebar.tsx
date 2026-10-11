import { Coins } from "lucide-react";
import Link from "next/link";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { Leaderboard } from "@/components/forum/leaderboard";
import { SectionCard } from "@/components/forum/section-card";
import { ShopIcon } from "@/components/forum/shop-icon";
import { StatInline } from "@/components/forum/stat";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getLeaderboard, getShopItems, type UserView } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const viewAllClass =
  "relative text-xs font-medium text-muted-foreground transition-colors after:absolute after:-inset-x-2 after:-inset-y-3.5 hover:text-foreground";

function MemberSummary({ user }: { user: UserView }) {
  const stats = [
    { label: "Posts", value: user.postCount },
    { label: "Reactions", value: user.reactionCount },
    { label: "Reputation", value: user.reputation },
    { label: "Vouches", value: user.vouches },
  ];
  return (
    <section
      aria-label="Your account"
      className="relative isolate overflow-hidden rounded-lg border bg-card"
    >
      <CoverBackdrop cover={user.appearance.cover} variant="strip" />
      <div className="px-4 pt-8 pb-4">
        <div className="flex items-end gap-3">
          <UserAvatar user={user} size="xl" className="ring-4 ring-card" />
          <Link
            href="/credits"
            aria-label={`${formatNumber(user.credits)} credits`}
            className="relative mb-1 ml-auto rounded-full after:absolute after:-inset-2.5"
          >
            <Badge variant="outline" className="tabular-nums">
              <Coins className="text-primary" />
              {formatNumber(user.credits)}
            </Badge>
          </Link>
        </div>
        <p className="mt-2 flex items-center gap-1.5">
          <UserLink user={user} className="truncate text-sm" />
          <UserBadges user={user} />
        </p>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3">
          {stats.map((stat) => (
            <StatInline
              key={stat.label}
              label={stat.label}
              value={formatNumber(stat.value)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function JoinCard() {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">Join the community</h2>
      <p className="mt-1 text-sm text-pretty text-muted-foreground">
        Create an account to post threads, earn awards and follow other members.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link
          href="/login"
          className={cn(buttonVariants({ variant: "outline" }), "h-10 lg:h-8")}
        >
          Log in
        </Link>
        <Link href="/register" className={cn(buttonVariants(), "h-10 lg:h-8")}>
          Create Account
        </Link>
      </div>
    </section>
  );
}

export async function ForumSidebar({ viewer }: { viewer: UserView | null }) {
  const [items, topMembers] = await Promise.all([
    getShopItems(),
    getLeaderboard("xp", 5),
  ]);
  const latestItems = items.toSorted((a, b) => b.id - a.id).slice(0, 5);

  return (
    <>
      {viewer ? <MemberSummary user={viewer} /> : <JoinCard />}

      <SectionCard
        title="Latest shop items"
        action={
          <Link href="/credits" className={viewAllClass}>
            View all
          </Link>
        }
      >
        {latestItems.map((item) => (
          <Link
            key={item.id}
            href={`/credits?category=${item.category}`}
            className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-muted/30"
          >
            <ShopIcon
              category={item.category}
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 flex-1 truncate font-medium">
              {item.name}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-muted-foreground">
              <Coins aria-hidden="true" className="size-3.5 text-primary" />
              {formatNumber(item.price)}
              <span className="sr-only"> credits</span>
            </span>
          </Link>
        ))}
      </SectionCard>

      <SectionCard
        title="Top members"
        action={
          <Link href="/members?view=level" className={viewAllClass}>
            View all
          </Link>
        }
      >
        <Leaderboard members={topMembers} by="xp" viewerId={viewer?.id} />
      </SectionCard>
    </>
  );
}
