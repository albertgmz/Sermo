import { Crown } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Directory } from "@/app/(main)/members/directory";
import { MembersNav } from "@/app/(main)/members/members-nav";
import { Overview } from "@/app/(main)/members/overview";
import { type MembersView, VIEWS } from "@/app/(main)/members/views";
import { EmptyState } from "@/components/forum/empty-state";
import { Leaderboard } from "@/components/forum/leaderboard";
import { MemberCard } from "@/components/forum/member-card";
import { SectionCard } from "@/components/forum/section-card";
import {
  HeadingSkeleton,
  LoadingRegion,
  MemberCardSkeleton,
  MemberListSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import {
  MonthHero,
  StandingList,
  WinnerList,
} from "@/components/forum/standing";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getLastMonthStanding,
  getLeaderboard,
  getPastWinners,
  getStaff,
  type LeaderboardKind,
} from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("members.members");
  return { title: t("metaTitle") };
}

const PAST_WINNERS = 12;

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : (value ?? "")).trim();
}

async function MonthView({ viewerId }: { viewerId?: number }) {
  const t = await getTranslations("members.members");
  const format = await getFormatter();
  const [{ month, entries: standing }, pastWinners] = await Promise.all([
    getLastMonthStanding(),
    getPastWinners(PAST_WINNERS),
  ]);
  const winner = standing[0] ? { ...standing[0], ...month } : null;
  const monthName = format.dateTime(
    new Date(Date.UTC(month.year, month.month - 1, 1)),
    {
      month: "long",
      year: "numeric",
    },
  );
  return (
    <>
      {winner ? (
        <>
          <MonthHero winner={winner} />
          <SectionCard
            title={t("standingHeading")}
            description={t("membersScored", {
              month: monthName,
              count: standing.length,
            })}
          >
            <StandingList entries={standing} viewerId={viewerId} />
          </SectionCard>
        </>
      ) : (
        <div className="rounded-lg border bg-card">
          <EmptyState
            icon={Crown}
            title={t("emptyTitle")}
            description={t("emptyDescription", { month: monthName })}
          />
        </div>
      )}
      {pastWinners.length > 0 && (
        <SectionCard title={t("winnersHeading")}>
          <WinnerList winners={pastWinners} />
        </SectionCard>
      )}
    </>
  );
}

async function RankingView({
  title,
  by,
  viewerId,
}: {
  title: string;
  by: LeaderboardKind;
  viewerId?: number;
}) {
  const t = await getTranslations("members.members");
  const members = await getLeaderboard(by, Number.POSITIVE_INFINITY);
  return (
    <SectionCard
      title={title}
      description={t("members", { count: members.length })}
    >
      <Leaderboard members={members} by={by} viewerId={viewerId} />
    </SectionCard>
  );
}

async function StaffView() {
  const staff = await getStaff();
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {staff.map((user) => (
        <MemberCard key={user.id} user={user} />
      ))}
    </div>
  );
}

export default async function MembersPage({
  searchParams,
}: PageProps<"/members">) {
  const t = await getTranslations("members.members");
  const views = await getTranslations("members.views");
  const params = await searchParams;
  const query = first(params.q);
  const sort = first(params.sort);
  // A search or a sort without a view is a link to the directory.
  const param = first(params.view) || (query || sort ? "all" : "");
  const view: MembersView & (typeof VIEWS)[number] =
    VIEWS.find((entry) => entry.value === param) ?? VIEWS[0];
  const viewerId = (await getCurrentUser())?.id;

  return (
    <PageLayout
      aside={<MembersNav active={view.value} variant="list" />}
      asideSide="start"
      asideOnMobile="hidden"
      mainClassName="space-y-(--page-gap)"
    >
      <header>
        <h1 className="text-2xl font-bold tracking-tight">
          {view.value === "overview" ? t("heading") : views(view.label)}
        </h1>
        <p className="text-sm text-pretty text-muted-foreground">
          {views(view.description)}
        </p>
      </header>

      <MembersNav active={view.value} variant="chips" className="lg:hidden" />

      {view.value === "overview" && <Overview viewerId={viewerId} />}
      {view.value === "month" && (
        <Suspense
          fallback={
            <LoadingRegion label={t("loading")}>
              <div className="rounded-lg border bg-card p-6">
                <HeadingSkeleton />
              </div>
              <MemberListSkeleton rows={10} />
              <MemberListSkeleton rows={3} />
            </LoadingRegion>
          }
        >
          <MonthView viewerId={viewerId} />
        </Suspense>
      )}
      {view.ranking && (
        <Suspense
          fallback={
            <LoadingRegion label={t("loading")}>
              <MemberListSkeleton rows={10} />
            </LoadingRegion>
          }
        >
          <RankingView
            title={views(view.label)}
            by={view.ranking}
            viewerId={viewerId}
          />
        </Suspense>
      )}
      {view.value === "staff" && (
        <Suspense
          fallback={
            <LoadingRegion label={t("loading")}>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[1, 2, 3].map((member) => (
                  <MemberCardSkeleton key={member} />
                ))}
              </div>
            </LoadingRegion>
          }
        >
          <StaffView />
        </Suspense>
      )}
      {view.value === "all" && (
        <Suspense
          fallback={
            <LoadingRegion label={t("loading")}>
              <div className="rounded-lg border bg-card p-3">
                <Skeleton className="h-10 w-full" />
              </div>
              <TabsSkeleton />
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[1, 2, 3, 4, 5, 6].map((member) => (
                  <MemberCardSkeleton key={member} />
                ))}
              </div>
            </LoadingRegion>
          }
        >
          <Directory query={query} sort={sort} />
        </Suspense>
      )}
    </PageLayout>
  );
}
