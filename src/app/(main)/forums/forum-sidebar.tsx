import { Coins } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { CoverBackdrop } from "@/components/forum/cover-backdrop";
import { Leaderboard } from "@/components/forum/leaderboard";
import { SectionCard } from "@/components/forum/section-card";
import { ShopIcon } from "@/components/forum/shop-icon";
import {
  CardSkeleton,
  LoadingRegion,
  MemberListSkeleton,
} from "@/components/forum/skeletons";
import { StatInline } from "@/components/forum/stat";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserBadges } from "@/components/forum/user-badges";
import { UserLink } from "@/components/forum/user-link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getLeaderboard, getShopItems, type UserView } from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const viewAllClass =
  "relative text-xs font-medium text-muted-foreground transition-colors after:absolute after:-inset-x-2 after:-inset-y-3.5 hover:text-foreground";

function MemberSummary({ user }: { user: UserView }) {
  const t = useTranslations("forums.forumSidebar");
  const stats = [
    { label: "postsLabel", value: user.postCount },
    { label: "reactionsLabel", value: user.reactionCount },
    { label: "reputationLabel", value: user.reputation },
    { label: "vouchesLabel", value: user.vouches },
  ] as const;
  return (
    <section
      aria-label={t("aria.account")}
      className="relative isolate overflow-hidden rounded-lg border bg-card"
    >
      <CoverBackdrop cover={user.appearance.cover} variant="strip" />
      <div className="px-4 pt-8 pb-4">
        <div className="flex items-end gap-3">
          <UserAvatar user={user} size="xl" className="ring-4 ring-card" />
          <Link
            href="/credits"
            aria-label={t("aria.credits", { count: user.credits })}
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
              label={t(stat.label)}
              value={formatNumber(stat.value)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function JoinCard() {
  const t = useTranslations("forums.forumSidebar");
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">{t("heading")}</h2>
      <p className="mt-1 text-sm text-pretty text-muted-foreground">
        {t("description")}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link
          href="/login"
          className={cn(buttonVariants({ variant: "outline" }), "h-10 lg:h-8")}
        >
          {t("login")}
        </Link>
        <Link href="/register" className={cn(buttonVariants(), "h-10 lg:h-8")}>
          {t("register")}
        </Link>
      </div>
    </section>
  );
}

export function ForumSidebar({ viewer }: { viewer: UserView | null }) {
  const t = useTranslations("forums.forumSidebar");
  return (
    <>
      {viewer ? <MemberSummary user={viewer} /> : <JoinCard />}

      <Suspense
        fallback={
          <LoadingRegion label={t("aria.loadingShop")}>
            <CardSkeleton>
              {[1, 2, 3, 4, 5].map((row) => (
                <div key={row} className="flex h-11 items-center gap-3 px-4">
                  <Skeleton className="size-4" />
                  <Skeleton className="h-5 w-2/3" />
                </div>
              ))}
            </CardSkeleton>
          </LoadingRegion>
        }
      >
        <LatestShopItems />
      </Suspense>

      <Suspense
        fallback={
          <LoadingRegion label={t("aria.loadingMembers")}>
            <MemberListSkeleton />
          </LoadingRegion>
        }
      >
        <TopMembers viewer={viewer} />
      </Suspense>
    </>
  );
}

async function LatestShopItems() {
  const items = await getShopItems();
  const t = await getTranslations("forums.forumSidebar");
  const latestItems = items.toSorted((a, b) => b.id - a.id).slice(0, 5);
  return (
    <SectionCard
      title={t("shopHeading")}
      action={
        <Link href="/credits" className={viewAllClass}>
          {t("shopViewAll")}
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
            {t.rich("credits", {
              count: item.price,
              unit: (chunks) => <span className="sr-only">{chunks}</span>,
            })}
          </span>
        </Link>
      ))}
    </SectionCard>
  );
}

async function TopMembers({ viewer }: { viewer: UserView | null }) {
  const topMembers = await getLeaderboard("xp", 5);
  const t = await getTranslations("forums.forumSidebar");
  return (
    <SectionCard
      title={t("membersHeading")}
      action={
        <Link href="/members?view=level" className={viewAllClass}>
          {t("membersViewAll")}
        </Link>
      }
    >
      <Leaderboard members={topMembers} by="xp" viewerId={viewer?.id} />
    </SectionCard>
  );
}
