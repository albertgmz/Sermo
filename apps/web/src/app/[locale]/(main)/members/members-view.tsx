import { standingsWinners, usersStaff } from "@sermo/core/contracts";
import { Crown } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Directory } from "@/app/[locale]/(main)/members/directory";
import { MembersNav } from "@/app/[locale]/(main)/members/members-nav";
import {
  monthHref,
  monthPage,
  monthParam,
} from "@/app/[locale]/(main)/members/month-page";
import {
  moreMonth,
  moreRanking,
} from "@/app/[locale]/(main)/members/more-members";
import { Overview } from "@/app/[locale]/(main)/members/overview";
import { rankingPage } from "@/app/[locale]/(main)/members/ranking-page";
import { StaffList } from "@/app/[locale]/(main)/members/staff-list";
import {
  type MemberSort,
  VIEWS,
  type ViewValue,
  viewHref,
} from "@/app/[locale]/(main)/members/views";
import { EmptyState } from "@/components/forum/empty-state";
import type { LeaderboardKind } from "@/components/forum/leaderboard";
import { PagedList } from "@/components/forum/paged-list";
import { SectionCard, SectionHeader } from "@/components/forum/section-card";
import {
  HeadingSkeleton,
  LoadingRegion,
  MemberCardSkeleton,
  MemberListSkeleton,
  MemberRowSkeleton,
  TabsSkeleton,
} from "@/components/forum/skeletons";
import { MonthHero, WinnerList } from "@/components/forum/standing";
import { PageLayout } from "@/components/layout/page-layout";
import { Skeleton } from "@/components/ui/skeleton";
import { MonthPicker, monthValue } from "@/components/widgets/month-picker";
import { pagesParam } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { getViewer } from "@/lib/sermo/session";

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : (value ?? "")).trim();
}

async function MonthView({
  month,
  cursor,
  pages,
}: {
  month?: string;
  cursor?: string;
  pages: number;
}) {
  const [t, loadMore, format, winners, standing] = await Promise.all([
    getTranslations("members.members"),
    getTranslations("members.loadMore"),
    getFormatter(),
    read(standingsWinners, { limit: 24 }),
    monthPage(cursor, month),
  ]);
  // The member of the month is the winner decided for the month being looked at, if it has one.
  const winner = winners.items.find(
    (entry) => entry.year === standing.year && entry.month === standing.month,
  );
  const past = winners.items.filter((entry) => entry !== winner).slice(0, 12);
  const monthName = format.dateTime(
    new Date(Date.UTC(standing.year, standing.month - 1, 1)),
    { month: "long", year: "numeric", timeZone: "UTC" },
  );
  const now = new Date();
  return (
    <>
      <div className="rounded-lg border bg-card p-3">
        <MonthPicker
          id="standing-month"
          value={monthValue(standing.year, standing.month)}
          max={monthValue(now.getUTCFullYear(), now.getUTCMonth() + 1)}
        />
      </div>
      {winner && <MonthHero winner={winner} />}
      {standing.rows.length > 0 ? (
        <PagedList
          first={standing}
          more={moreMonth.bind(null, month ?? null)}
          pages={pages}
          start={cursor}
          listKey={["members", "month", month ?? "previous"]}
          hrefBase={monthHref(month)}
          moreLabel={loadMore("label")}
          estimateSize={72}
          as="ul"
          className="overflow-hidden rounded-lg border bg-card"
          header={
            <SectionHeader
              title={t("standingHeading")}
              description={t("monthStanding", { month: monthName })}
            />
          }
        />
      ) : (
        !winner && (
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
  cursor,
  pages,
}: {
  view: ViewValue;
  title: string;
  sort: MemberSort;
  by: LeaderboardKind;
  cursor?: string;
  pages: number;
}) {
  const [first, loadMore] = await Promise.all([
    rankingPage(sort, by, cursor),
    getTranslations("members.loadMore"),
  ]);
  return (
    <PagedList
      first={first}
      more={moreRanking.bind(null, view)}
      pages={pages}
      start={cursor}
      listKey={["members", view]}
      hrefBase={viewHref(view)}
      moreLabel={loadMore("label")}
      estimateSize={56}
      as="ul"
      className="overflow-hidden rounded-lg border bg-card"
      header={<SectionHeader title={title} />}
    />
  );
}

async function StaffView() {
  const { items } = await read(usersStaff, {});
  return <StaffList staff={items} />;
}

// The members section, one view at a time: the view and its options come from the page's address
// parameters (`/members` and `/members/month` both draw it).
export async function MembersView({
  params,
}: {
  params: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations("members.members");
  const views = await getTranslations("members.views");
  const query = first(params.q);
  const sort = first(params.sort);
  const cursor = first(params.cursor) || undefined;
  const pages = pagesParam(params.pages);
  // A search or a sort without a view is a link to the directory.
  const param = first(params.view) || (query || sort ? "all" : "");
  const view = VIEWS.find((entry) => entry.value === param) ?? VIEWS[0];
  const viewer = await getViewer();
  // The member list is the backend's to refuse: a viewer without `member.viewList` finds none.
  if (viewer.resolvedPermissions["member.viewList"] === false) notFound();
  const viewerId = viewer.user?.id;

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
          <MonthView
            month={monthParam(first(params.month))}
            cursor={cursor}
            pages={pages}
          />
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
            cursor={cursor}
            pages={pages}
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
          <Directory query={query} sort={sort} cursor={cursor} pages={pages} />
        </Suspense>
      )}
    </PageLayout>
  );
}
