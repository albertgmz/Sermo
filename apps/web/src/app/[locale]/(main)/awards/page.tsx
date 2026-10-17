import {
  awardsList,
  awardsMember,
  profilesGet,
  usersList,
} from "@sermo/core/contracts";
import { Check, Lock } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { TIER_ORDER, TIERS } from "@/app/[locale]/(main)/awards/tiers";
import { Art } from "@/components/forum/art";
import { AwardIcon } from "@/components/forum/award-icon";
import { Leaderboard } from "@/components/forum/leaderboard";
import { levelWithBounds, XpBar } from "@/components/forum/level";
import { SectionCard } from "@/components/forum/section-card";
import {
  CatalogueSkeleton,
  LoadingRegion,
  MemberListSkeleton,
} from "@/components/forum/skeletons";
import { UserAvatar } from "@/components/forum/user-avatar";
import { Container } from "@/components/layout/container";
import { PageHero } from "@/components/layout/page-hero";
import { PageLayout } from "@/components/layout/page-layout";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatNumber } from "@/lib/format";
import { read, readIfAllowed } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";
import { publicHead } from "@/lib/sermo/share";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("awards.awards");
  return publicHead({ title: t("metaTitle") }, { path: "/awards" });
}

// The backend adds the inactive awards for holders of admin.awards; the public page is the same
// for everyone, so only the active ones are shown (and counted). The list needs the permission to
// view profiles, which a guest may lack: then the page says so instead of failing.
async function listAwards() {
  const listed = await readIfAllowed(awardsList, {});
  return {
    items: (listed?.items ?? []).filter(({ isActive }) => isActive),
    restricted: listed === null,
  };
}

type Award = Awaited<ReturnType<typeof listAwards>>["items"][number];

// The awards the viewer holds, with the date of the last grant.
async function heldBy(userId: number | undefined) {
  if (userId === undefined) return null;
  const held = await read(awardsMember, { userId });
  return new Map(
    held.items.map(({ award, lastGrantedAt }) => [award.id, lastGrantedAt]),
  );
}

async function Progress({
  userId,
  username,
}: {
  userId: number;
  username: string;
}) {
  const locale = await getLocale();
  const [t, profile, held, awards, member] = await Promise.all([
    getTranslations("awards.awards"),
    read(profilesGet, { userId }),
    read(awardsMember, { userId }),
    listAwards(),
    membersFor([{ id: userId, username }]),
  ]);
  const { level } = profile;
  const bar = levelWithBounds(
    level.level,
    profile.awardXp,
    level.currentLevelXp,
    level.nextLevelXp,
  );
  return (
    <Container>
      <section
        aria-labelledby="progress-title"
        className="rounded-lg border bg-card p-4 md:p-6"
      >
        <h2 id="progress-title" className="text-sm font-semibold">
          {t("progressHeading")}
        </h2>
        <div className="mt-4 grid gap-5 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:gap-10">
          <div className="flex items-center gap-4">
            <UserAvatar user={member(userId)} size="xl" />
            <div>
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t("levelLabel")}
              </p>
              <p className="text-5xl leading-none font-bold tracking-tighter tabular-nums">
                {formatNumber(bar.level, locale)}
              </p>
            </div>
          </div>
          <div className="grid gap-2">
            <XpBar level={bar} className="w-full" />
            <p className="text-sm text-muted-foreground tabular-nums">
              {t.rich("xpProgress", {
                xp: formatNumber(bar.xp, locale),
                nextXp: formatNumber(bar.nextLevelXp, locale),
                level: formatNumber(bar.level + 1, locale),
                current: (chunks) => (
                  <span className="font-semibold text-foreground">
                    {chunks}
                  </span>
                ),
              })}
            </p>
          </div>
          <div className="border-t pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-10">
            <p className="text-2xl leading-none font-bold tracking-tight tabular-nums">
              {t.rich("awardsProgress", {
                earned: formatNumber(held.items.length, locale),
                total: formatNumber(awards.items.length, locale),
                maximum: (chunks) => (
                  <span className="text-base font-medium text-muted-foreground">
                    {chunks}
                  </span>
                ),
              })}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("earnedLabel")}
            </p>
          </div>
        </div>
      </section>
    </Container>
  );
}

function AwardCard({
  award,
  earnedAt,
  locked,
  holders,
  xp,
  note,
}: {
  award: Award;
  earnedAt?: string;
  locked: boolean;
  holders: string;
  xp: string;
  // "Earned <date>" or "Locked", whichever applies to a signed-in viewer.
  note: string;
}) {
  return (
    <li
      className={cn(
        "relative isolate flex gap-3 overflow-hidden rounded-lg border bg-card p-4 transition-colors hover:border-input",
        locked && "bg-transparent",
      )}
    >
      {award.image && (
        <Art
          category="awards"
          src={award.image.url}
          className={cn(
            "absolute inset-y-0 right-0 -z-10 aspect-video [mask-image:linear-gradient(to_left,black,transparent_85%)]",
            locked ? "opacity-20 grayscale" : "opacity-45",
          )}
        />
      )}
      <AwardIcon
        award={award}
        size="lg"
        className={locked ? "opacity-40 grayscale" : undefined}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h4
            className={cn(
              "text-sm font-semibold [overflow-wrap:anywhere]",
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
            {xp}
          </span>
        </div>
        <p className="mt-0.5 text-sm text-pretty text-muted-foreground [overflow-wrap:anywhere]">
          {award.description}
        </p>
        <div className="mt-3 flex min-h-5 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span className="tabular-nums">{holders}</span>
          {earnedAt && (
            <span className="inline-flex items-center gap-1 font-medium text-success">
              <Check aria-hidden="true" className="size-3.5" />
              {note}
            </span>
          )}
          {locked && (
            <span className="inline-flex items-center gap-1">
              <Lock aria-hidden="true" className="size-3" />
              {note}
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

async function Catalogue({ userId }: { userId: number | undefined }) {
  const locale = await getLocale();
  const [t, tTiers, awards, held] = await Promise.all([
    getTranslations("awards.awards"),
    getTranslations("awards.tiers"),
    listAwards(),
    heldBy(userId),
  ]);
  if (awards.items.length === 0) {
    return (
      <p className="rounded-lg border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
        {awards.restricted ? t("restricted") : t("empty")}
      </p>
    );
  }
  return (
    <section aria-labelledby="catalogue-title" className="space-y-6">
      <h2 id="catalogue-title" className="sr-only">
        {t("catalogueHeading")}
      </h2>
      {TIER_ORDER.map((tier) => {
        const group = awards.items.filter((award) => award.tier === tier);
        if (group.length === 0) return null;
        const owned = group.filter((award) => held?.has(award.id));
        return (
          <section key={tier} className="space-y-3">
            <div className="flex items-center justify-between gap-3 border-b pb-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <span
                  aria-hidden="true"
                  className={cn("size-2 rounded-full", TIERS[tier].dot)}
                />
                <span className={TIERS[tier].text}>{tTiers(tier)}</span>
              </h3>
              <p className="text-xs text-muted-foreground tabular-nums">
                {held
                  ? t("earnedCount", {
                      earned: formatNumber(owned.length, locale),
                      total: formatNumber(group.length, locale),
                    })
                  : t("awards", { count: group.length })}
              </p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {group.map((award) => {
                const earnedAt = held?.get(award.id);
                return (
                  <AwardCard
                    key={award.id}
                    award={award}
                    earnedAt={earnedAt}
                    locked={Boolean(held) && !earnedAt}
                    xp={t("xpReward", { xp: formatNumber(award.xp, locale) })}
                    holders={t("holders", { count: award.grantCount })}
                    note={
                      earnedAt
                        ? t("earnedDate", {
                            date: formatDate(earnedAt, locale),
                          })
                        : t("lockedLabel")
                    }
                  />
                );
              })}
            </ul>
          </section>
        );
      })}
    </section>
  );
}

async function Leaders({ viewerId }: { viewerId?: number }) {
  const [t, leaders] = await Promise.all([
    getTranslations("awards.awards"),
    readIfAllowed(usersList, { sort: "level", limit: 10 }),
  ]);
  // The member directory needs a permission a guest may lack: then there is no ranking to show.
  if (!leaders) return null;
  return (
    <SectionCard
      title={t("leadersHeading")}
      description={t("leadersDescription")}
    >
      <Leaderboard members={leaders.items} by="xp" viewerId={viewerId} />
    </SectionCard>
  );
}

async function AwardHero() {
  const [t, { user }] = await Promise.all([
    getTranslations("awards.awards"),
    getViewer(),
  ]);
  return (
    <PageHero title={t("heading")} subtitle={t("description")}>
      {!user && (
        <Link
          href={`/login?next=${encodeURIComponent("/awards")}`}
          className={cn(buttonVariants(), "h-10 px-4")}
        >
          {t("login")}
        </Link>
      )}
    </PageHero>
  );
}

async function AwardsContent() {
  const [t, { user }] = await Promise.all([
    getTranslations("awards.awards"),
    getViewer(),
  ]);
  return (
    <>
      {user && (
        <Suspense
          fallback={
            <LoadingRegion label={t("loadingProgress")}>
              <Container>
                <Skeleton className="h-40 w-full" />
              </Container>
            </LoadingRegion>
          }
        >
          <Progress userId={user.id} username={user.username} />
        </Suspense>
      )}
      <PageLayout
        className={user ? "pt-6" : "pt-0"}
        aside={
          <Suspense
            fallback={
              <LoadingRegion label={t("loadingMembers")}>
                <MemberListSkeleton rows={10} />
              </LoadingRegion>
            }
          >
            <Leaders viewerId={user?.id} />
          </Suspense>
        }
      >
        <Suspense
          fallback={
            <LoadingRegion label={t("loadingCatalogue")}>
              <CatalogueSkeleton />
            </LoadingRegion>
          }
        >
          <Catalogue userId={user?.id} />
        </Suspense>
      </PageLayout>
    </>
  );
}

export default async function AwardsPage() {
  const t = await getTranslations("awards.awards");
  return (
    <>
      <Suspense
        fallback={
          <LoadingRegion label={t("loadingIntroduction")}>
            <PageHero title={t("heading")} subtitle={t("description")} />
          </LoadingRegion>
        }
      >
        <AwardHero />
      </Suspense>
      <Suspense
        fallback={
          <LoadingRegion label={t("loadingAwards")}>
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
