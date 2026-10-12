import { Check, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { TIER_ORDER, TIERS } from "@/app/(main)/awards/tiers";
import { Art } from "@/components/forum/art";
import { AwardIcon } from "@/components/forum/award-icon";
import { Leaderboard } from "@/components/forum/leaderboard";
import { LevelBadge, XpBar } from "@/components/forum/level";
import { SectionCard } from "@/components/forum/section-card";
import {
  CardSkeleton,
  CatalogueSkeleton,
  LoadingRegion,
  MemberListSkeleton,
  TextSkeleton,
} from "@/components/forum/skeletons";
import { UserAvatar } from "@/components/forum/user-avatar";
import { Container } from "@/components/layout/container";
import { PageHero } from "@/components/layout/page-hero";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type AwardView,
  getAwards,
  getLeaderboard,
  type UserView,
} from "@/lib/db";
import { formatDate, formatNumber } from "@/lib/format";
import { levelForXp, xpForLevel } from "@/lib/levels";
import { getCurrentUser } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Awards - forum/ui",
};

const MAX_HOLDER_AVATARS = 4;

function Progress({ viewer, total }: { viewer: UserView; total: number }) {
  const { level } = viewer;
  return (
    <section
      aria-labelledby="progress-title"
      className="rounded-lg border bg-card p-4 md:p-6"
    >
      <h2 id="progress-title" className="text-sm font-semibold">
        Your progress
      </h2>
      <div className="mt-4 grid gap-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:gap-10">
        <div className="flex items-center gap-4">
          <UserAvatar user={viewer} size="xl" />
          <div>
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Level
            </p>
            <p className="text-5xl leading-none font-bold tracking-tighter tabular-nums">
              {level.level}
            </p>
          </div>
        </div>
        <div className="grid gap-2">
          <XpBar level={level} className="w-full" />
          <p className="text-sm text-muted-foreground tabular-nums">
            <span className="font-semibold text-foreground">
              {formatNumber(level.xp)}
            </span>{" "}
            / {formatNumber(level.nextLevelXp)} XP to level {level.level + 1}
          </p>
        </div>
        <div className="border-t pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-10">
          <p className="text-2xl leading-none font-bold tracking-tight tabular-nums">
            {viewer.awards.length}
            <span className="text-base font-medium text-muted-foreground">
              {" "}
              / {total}
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Awards earned</p>
        </div>
      </div>
    </section>
  );
}

function AwardCard({
  award,
  earnedAt,
  locked,
}: {
  award: AwardView;
  earnedAt?: string;
  locked: boolean;
}) {
  const holders = award.holders.length;
  return (
    <li
      className={cn(
        "relative isolate flex gap-3 overflow-hidden rounded-lg border bg-card p-4 transition-colors hover:border-input",
        locked && "bg-transparent",
      )}
    >
      <Art
        category="awards"
        src={award.image}
        className={cn(
          "absolute inset-y-0 right-0 -z-10 aspect-video [mask-image:linear-gradient(to_left,black,transparent_85%)]",
          locked ? "opacity-20 grayscale" : "opacity-45",
        )}
      />
      <AwardIcon
        award={award}
        size="lg"
        className={locked ? "opacity-40 grayscale" : undefined}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h4
            className={cn(
              "text-sm font-semibold",
              locked && "text-muted-foreground",
            )}
          >
            <Link
              href={`/awards/${award.id}`}
              className="rounded-lg outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring"
            >
              {award.name}
            </Link>
          </h4>
          <span
            className={cn(
              "shrink-0 text-xs leading-5 font-semibold tabular-nums",
              locked ? "text-muted-foreground" : TIERS[award.tier].text,
            )}
          >
            +{formatNumber(award.xp)} XP
          </span>
        </div>
        <p className="mt-0.5 text-sm text-pretty text-muted-foreground">
          {award.description}
        </p>
        <div className="mt-3 flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            {holders > 0 && (
              <div className="flex -space-x-1.5">
                {award.holders.slice(0, MAX_HOLDER_AVATARS).map(({ user }) => (
                  <UserAvatar
                    key={user.id}
                    user={user}
                    size="xs"
                    link={false}
                    className={cn(
                      "ring-2",
                      locked ? "ring-background" : "ring-card",
                    )}
                  />
                ))}
              </div>
            )}
            <span className="tabular-nums">
              {holders === 0
                ? "No holders yet"
                : `${formatNumber(holders)} ${holders === 1 ? "holder" : "holders"}`}
            </span>
          </div>
          {earnedAt && (
            <span className="inline-flex items-center gap-1 font-medium text-success">
              <Check aria-hidden="true" className="size-3.5" />
              Earned {formatDate(earnedAt)}
            </span>
          )}
          {locked && (
            <span className="inline-flex items-center gap-1">
              <Lock aria-hidden="true" className="size-3" />
              Locked
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

function Ladder({
  viewer,
  maxLevel,
}: {
  viewer: UserView | null;
  maxLevel: number;
}) {
  const levels = Array.from({ length: maxLevel }, (_, index) => index + 1);
  return (
    <SectionCard title="How levels work">
      <p className="px-4 py-3 text-sm text-pretty text-muted-foreground">
        XP comes only from awards: every award you earn adds its XP to your
        total, and your level follows from that total.
      </p>
      <ol
        className="grid grid-flow-col grid-cols-2 gap-1.5 p-3"
        style={{
          gridTemplateRows: `repeat(${Math.ceil(maxLevel / 2)}, minmax(0, 1fr))`,
        }}
      >
        {levels.map((level) => {
          const current = viewer?.level.level === level;
          return (
            <li
              key={level}
              aria-current={current ? "true" : undefined}
              className={cn(
                "flex h-9 items-center justify-between gap-2 rounded-md border px-2 text-xs tabular-nums",
                current
                  ? "border-primary/50 bg-primary/10"
                  : "text-muted-foreground",
              )}
            >
              <LevelBadge
                level={{ level }}
                className={
                  current ? "border-primary/50 bg-transparent" : undefined
                }
              />
              <span className={cn("font-medium", current && "text-foreground")}>
                {current && <span className="sr-only">Your level: </span>}
                {formatNumber(xpForLevel(level))} XP
              </span>
            </li>
          );
        })}
      </ol>
    </SectionCard>
  );
}

async function AwardsContent() {
  const viewer = await getCurrentUser();
  return (
    <>
      <Suspense
        fallback={
          <LoadingRegion label="Loading award progress…">
            <Container>
              <Skeleton className="h-40 w-full" />
            </Container>
          </LoadingRegion>
        }
      >
        <AwardProgress viewer={viewer} />
      </Suspense>
      <PageLayout
        className={viewer ? "pt-6" : "pt-0"}
        aside={
          <>
            <Suspense
              fallback={
                <LoadingRegion label="Loading top members…">
                  <MemberListSkeleton rows={10} />
                </LoadingRegion>
              }
            >
              <AwardLeaders viewerId={viewer?.id} />
            </Suspense>
            <Suspense
              fallback={
                <LoadingRegion label="Loading levels…">
                  <CardSkeleton>
                    <div className="space-y-3 p-4">
                      <TextSkeleton />
                      <Skeleton className="h-40 w-full" />
                    </div>
                  </CardSkeleton>
                </LoadingRegion>
              }
            >
              <AwardLadder viewer={viewer} />
            </Suspense>
          </>
        }
      >
        <Suspense
          fallback={
            <LoadingRegion label="Loading award catalogue…">
              <CatalogueSkeleton />
            </LoadingRegion>
          }
        >
          <AwardCatalogue viewer={viewer} />
        </Suspense>
      </PageLayout>
    </>
  );
}

async function AwardLeaders({ viewerId }: { viewerId?: number }) {
  const leaders = await getLeaderboard("xp", 10);
  return (
    <SectionCard title="Top members" description="Ranked by XP">
      <Leaderboard members={leaders} by="xp" viewerId={viewerId} />
    </SectionCard>
  );
}

export default function AwardsPage() {
  return (
    <>
      <Suspense
        fallback={
          <LoadingRegion label="Loading award introduction…">
            <PageHero
              title="Awards"
              subtitle="Collect awards for what you bring to the community. Every award is worth XP, and XP is what raises your level."
            />
          </LoadingRegion>
        }
      >
        <AwardHero />
      </Suspense>
      <Suspense
        fallback={
          <LoadingRegion label="Loading awards…">
            <PageLayout
              className="pt-0"
              aside={<MemberListSkeleton rows={10} />}
            >
              <CatalogueSkeleton />
            </PageLayout>
          </LoadingRegion>
        }
      >
        <AwardsContent />
      </Suspense>
    </>
  );
}

async function AwardHero() {
  const viewer = await getCurrentUser();
  return (
    <PageHero
      title="Awards"
      subtitle="Collect awards for what you bring to the community. Every award is worth XP, and XP is what raises your level."
    >
      {!viewer && (
        <Link href="/login" className={cn(buttonVariants(), "h-10 px-4")}>
          Log in to track your progress
        </Link>
      )}
    </PageHero>
  );
}

async function AwardProgress({ viewer }: { viewer: UserView | null }) {
  if (!viewer) return null;
  const awards = await getAwards();
  return (
    <>
      {viewer && (
        <Container>
          <Progress viewer={viewer} total={awards.length} />
        </Container>
      )}
    </>
  );
}

async function AwardLadder({ viewer }: { viewer: UserView | null }) {
  const awards = await getAwards();
  const maxLevel = levelForXp(
    awards.reduce((sum, award) => sum + award.xp, 0),
  ).level;
  return <Ladder viewer={viewer} maxLevel={maxLevel} />;
}

async function AwardCatalogue({ viewer }: { viewer: UserView | null }) {
  const awards = await getAwards();
  const earned = new Map(
    viewer?.awards.map((award) => [award.id, award.awardedAt]),
  );
  return (
    <section aria-labelledby="catalogue-title" className="space-y-6">
      <h2 id="catalogue-title" className="sr-only">
        All awards
      </h2>
      {TIER_ORDER.map((tier) => {
        const group = awards.filter((award) => award.tier === tier);
        if (group.length === 0) return null;
        const owned = group.filter((award) => earned.has(award.id));
        return (
          <section key={tier} className="space-y-3">
            <div className="flex items-center justify-between gap-3 border-b pb-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <span
                  aria-hidden="true"
                  className={cn("size-2 rounded-full", TIERS[tier].dot)}
                />
                <span className={TIERS[tier].text}>{TIERS[tier].label}</span>
              </h3>
              <p className="text-xs text-muted-foreground tabular-nums">
                {viewer
                  ? `${owned.length} of ${group.length} earned`
                  : `${group.length} ${group.length === 1 ? "award" : "awards"}`}
              </p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {group.map((award) => (
                <AwardCard
                  key={award.id}
                  award={award}
                  earnedAt={earned.get(award.id)}
                  locked={Boolean(viewer) && !earned.has(award.id)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
