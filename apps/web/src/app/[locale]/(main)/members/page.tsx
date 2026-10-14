import {
  standingsMonth,
  standingsWinners,
  usersList,
  usersStaff,
} from "@sermo/core/contracts";
import { Crown } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Directory } from "@/app/[locale]/(main)/members/directory";
import { MembersNav } from "@/app/[locale]/(main)/members/members-nav";
import { Overview } from "@/app/[locale]/(main)/members/overview";
import { StaffList } from "@/app/[locale]/(main)/members/staff-list";
import {
  type MemberSort,
  VIEWS,
  type ViewValue,
  viewHref,
} from "@/app/[locale]/(main)/members/views";
import { EmptyState } from "@/components/forum/empty-state";
import {
  Leaderboard,
  type LeaderboardKind,
} from "@/components/forum/leaderboard";
import { LoadMore } from "@/components/forum/load-more";
import { SectionCard } from "@/components/forum/section-card";
import {
  HeadingSkeleton,
  LoadingRegion,
  MemberCardSkeleton,
  MemberListSkeleton,
  MemberRowSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import {
  MonthHero,
  StandingList,
  WinnerList,
} from "@/components/forum/standing";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("members.members");
  return { title: t("metaTitle") };
}

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : (value ?? "")).trim();
}

// Where the next page of a list continues: the number of the first row travels with the cursor,
// since a cursor says nothing about how many rows came before it.
function nextHref(
  view: ViewValue,
  cursor: string,
  start: number,
  extra?: Record<string, string>,
) {
  const params = new URLSearchParams(extra);
  params.set("cursor", cursor);
  params.set("start", String(start));
  const base = viewHref(view);
  return `${base}${base.includes("?") ? "&" : "?"}${params}`;
}

async function MonthView({
  viewerId,
  cursor,
  start,
}: {
  viewerId?: number;
  cursor?: string;
  start: number;
}) {
  const [t, loadMore, format, winners, standing] = await Promise.all([
    getTranslations("members.members"),
    getTranslations("members.loadMore"),
    getFormatter(),
    read(standingsWinners, {}),
    read(standingsMonth, { month: "previous", cursor }),
  ]);
  // The first winner is the member of the month only while it is the last complete month's.
  const [latest, ...earlier] = winners.items;
  const current =
    latest?.year === standing.year && latest.month === standing.month;
  const winner = current ? latest : null;
  const past = current ? earlier : winners.items;
  // With no winner to show for the last month, the hero shows who leads the running one.
  const running = winner
    ? null
    : await read(standingsMonth, { month: "current", limit: 1 });
  const leader = running?.items[0];
  const monthName = format.dateTime(
    new Date(Date.UTC(standing.year, standing.month - 1, 1)),
    { month: "long", year: "numeric", timeZone: "UTC" },
  );
  return (
    <>
      {winner && <MonthHero winner={winner} />}
      {running && leader && (
        <MonthHero
          leading
          winner={{ ...leader, year: running.year, month: running.month }}
        />
      )}
      {standing.items.length > 0 ? (
        <SectionCard
          title={t("standingHeading")}
          description={t("monthStanding", { month: monthName })}
        >
          <StandingList
            entries={standing.items}
            viewerId={viewerId}
            start={start}
          />
          {standing.nextCursor && (
            <div className="p-3">
              <LoadMore
                href={nextHref(
                  "month",
                  standing.nextCursor,
                  start + standing.items.length,
                )}
              >
                {loadMore("label")}
              </LoadMore>
            </div>
          )}
        </SectionCard>
      ) : (
        !winner &&
        !leader && (
          <div className="rounded-lg border bg-card">
            <EmptyState
              icon={Crown}
              title={t("emptyTitle")}
              description={t("emptyDescription", { month: monthName })}
            />
          </div>
        )
      )}
      {past.length > 0 && (
        <SectionCard title={t("winnersHeading")}>
          <WinnerList winners={past} />
        </SectionCard>
      )}
    </>
  );
}

async function RankingView({
  view,
  title,
  sort,
  by,
  viewerId,
  cursor,
  start,
}: {
  view: ViewValue;
  title: string;
  sort: MemberSort;
  by: LeaderboardKind;
  viewerId?: number;
  cursor?: string;
  start: number;
}) {
  const [{ items, nextCursor }, loadMore] = await Promise.all([
    read(usersList, { sort, cursor }),
    getTranslations("members.loadMore"),
  ]);
  return (
    <SectionCard title={title}>
      <Leaderboard members={items} by={by} viewerId={viewerId} start={start} />
      {nextCursor && (
        <div className="p-3">
          <LoadMore href={nextHref(view, nextCursor, start + items.length)}>
            {loadMore("label")}
          </LoadMore>
        </div>
      )}
    </SectionCard>
  );
}

async function StaffView() {
  const { items } = await read(usersStaff, {});
  return <StaffList staff={items} />;
}

export default async function MembersPage({
  searchParams,
}: PageProps<"/[locale]/members">) {
  const t = await getTranslations("members.members");
  const views = await getTranslations("members.views");
  const params = await searchParams;
  const query = first(params.q);
  const sort = first(params.sort);
  const cursor = first(params.cursor) || undefined;
  const start = Math.min(
    1_000_000,
    Math.max(1, Math.floor(Number(first(params.start))) || 1),
  );
  // A search or a sort without a view is a link to the directory.
  const param = first(params.view) || (query || sort ? "all" : "");
  const view = VIEWS.find((entry) => entry.value === param) ?? VIEWS[0];
  const viewerId = (await getViewer()).user?.id;

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
          <MonthView viewerId={viewerId} cursor={cursor} start={start} />
        </Suspense>
      )}
      {"sort" in view && (
        <Suspense
          fallback={
            <LoadingRegion label={t("loading")}>
              <MemberListSkeleton rows={10} />
            </LoadingRegion>
          }
        >
          <RankingView
            view={view.value}
            title={views(view.label)}
            sort={view.sort}
            by={view.ranking}
            viewerId={viewerId}
            cursor={cursor}
            start={start}
          />
        </Suspense>
      )}
      {view.value === "staff" && (
        <Suspense
          fallback={
            <LoadingRegion label={t("loading")}>
              <div className="divide-y divide-border overflow-hidden rounded-lg border bg-card">
                {[1, 2, 3].map((member) => (
                  <MemberRowSkeleton key={member} />
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
          <Directory query={query} sort={sort} cursor={cursor} />
        </Suspense>
      )}
    </PageLayout>
  );
}
