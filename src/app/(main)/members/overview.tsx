import { Cake, Crown, Flag } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getFormatter, getNow, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { MemberSearch } from "@/app/(main)/members/member-search";
import { VIEWS, type ViewValue, viewHref } from "@/app/(main)/members/views";
import { EmptyState } from "@/components/forum/empty-state";
import { MemberRow } from "@/components/forum/member-row";
import { Podium } from "@/components/forum/podium";
import { SectionCard } from "@/components/forum/section-card";
import {
  BirthdaysSkeleton,
  LoadingRegion,
  MonthHeroSkeleton,
  NewestMembersSkeleton,
  PodiumSkeleton,
  RaceWinnersSkeleton,
  StaffRowsSkeleton,
} from "@/components/forum/skeletons";
import {
  MonthHero,
  StandingList,
  WinnerList,
} from "@/components/forum/standing";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import {
  getBirthdays,
  getCurrentMonthStanding,
  getLeaderboard,
  getMemberOfTheMonth,
  getNewestMembers,
  getPastWinners,
  getStaff,
  type UserView,
} from "@/lib/db";

const TOP = 5;
const RACE = 3;
const PAST_WINNERS = 3;
const NEWEST = 6;
const STAFF = 3;

const NOTABLE = VIEWS.filter((view) => "ranking" in view);

function ViewLink({
  view,
  children,
}: {
  view: ViewValue;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={viewHref(view)}
      className="-my-1 inline-flex min-h-10 items-center text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      {children}
    </Link>
  );
}

function NewestMembers({ members }: { members: UserView[] }) {
  return (
    <ul className="flex flex-wrap gap-2 px-4 py-3">
      {members.map((member) => (
        <li key={member.id}>
          <UserLink user={member} className="block w-fit rounded-full">
            <UserAvatar user={member} size="lg" link={false} />
            <span className="sr-only">{member.username}</span>
          </UserLink>
        </li>
      ))}
    </ul>
  );
}

async function MemberOfTheMonth() {
  const t = await getTranslations("members.overview");
  const winner = await getMemberOfTheMonth();
  return winner ? (
    <MonthHero
      winner={winner}
      action={<ViewLink view="month">{t("standingLink")}</ViewLink>}
    />
  ) : (
    <div className="rounded-lg border bg-card">
      <EmptyState
        icon={Crown}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
      />
    </div>
  );
}

async function RaceAndWinners({ viewerId }: { viewerId?: number }) {
  const t = await getTranslations("members.overview");
  const format = await getFormatter();
  const [race, pastWinners] = await Promise.all([
    getCurrentMonthStanding(RACE),
    getPastWinners(PAST_WINNERS),
  ]);
  const now = await getNow();

  return (
    <div className="grid gap-3 md:grid-cols-2 md:items-start">
      <SectionCard
        title={t("raceHeading")}
        description={format.dateTime(now, { month: "long", year: "numeric" })}
      >
        {race.length > 0 ? (
          <StandingList entries={race} viewerId={viewerId} />
        ) : (
          <EmptyState
            icon={Flag}
            title={t("raceEmptyTitle")}
            description={t("raceEmptyDescription")}
          />
        )}
      </SectionCard>

      {pastWinners.length > 0 && (
        <SectionCard
          title={t("winnersHeading")}
          action={<ViewLink view="month">{t("viewMore")}</ViewLink>}
        >
          <WinnerList winners={pastWinners} compact />
        </SectionCard>
      )}
    </div>
  );
}

async function NotablePodium({
  view,
  viewerId,
}: {
  view: (typeof NOTABLE)[number];
  viewerId?: number;
}) {
  const members = await getLeaderboard(view.ranking, TOP);
  return <Podium members={members} by={view.ranking} viewerId={viewerId} />;
}

async function StaffRows() {
  const staff = await getStaff();
  return staff
    .slice(0, STAFF)
    .map((user) => <MemberRow key={user.id} user={user} className="py-2" />);
}

async function NewestMembersList() {
  return <NewestMembers members={await getNewestMembers(NEWEST)} />;
}

async function Birthdays() {
  const t = await getTranslations("members.overview");
  const birthdays = await getBirthdays();
  return birthdays.length > 0 ? (
    birthdays.map((user) => (
      <MemberRow key={user.id} user={user} className="py-2">
        <Cake aria-hidden="true" className="size-4 shrink-0 text-primary" />
      </MemberRow>
    ))
  ) : (
    <p className="px-4 py-3 text-sm text-muted-foreground">
      {t("birthdaysEmpty")}
    </p>
  );
}

// Every block reads its own data behind its own boundary; the headings and
// the frames of the cards are there from the first paint. The first fallback
// of a group announces it, the others stay silent.
export function Overview({ viewerId }: { viewerId?: number }) {
  const t = useTranslations("members.overview");
  const views = useTranslations("members.views");
  return (
    <>
      <Suspense
        fallback={
          <LoadingRegion label={t("loadingMonth")}>
            <MonthHeroSkeleton />
          </LoadingRegion>
        }
      >
        <MemberOfTheMonth />
      </Suspense>

      <Suspense
        fallback={
          <LoadingRegion label={t("loadingRace")}>
            <RaceWinnersSkeleton />
          </LoadingRegion>
        }
      >
        <RaceAndWinners viewerId={viewerId} />
      </Suspense>

      <section aria-labelledby="notable-members" className="space-y-3">
        <h2
          id="notable-members"
          className="text-lg font-semibold tracking-tight"
        >
          {t("notableHeading")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {NOTABLE.map((view, index) => (
            <SectionCard
              key={view.value}
              title={views(view.label)}
              action={<ViewLink view={view.value}>{t("viewMore")}</ViewLink>}
            >
              <Suspense
                fallback={
                  index === 0 ? (
                    <LoadingRegion label={t("loadingNotable")}>
                      <PodiumSkeleton />
                    </LoadingRegion>
                  ) : (
                    <PodiumSkeleton />
                  )
                }
              >
                <NotablePodium view={view} viewerId={viewerId} />
              </Suspense>
            </SectionCard>
          ))}
        </div>
      </section>

      <section aria-labelledby="community" className="space-y-3">
        <h2 id="community" className="text-lg font-semibold tracking-tight">
          {t("communityHeading")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
          <SectionCard
            title={t("staffHeading")}
            action={<ViewLink view="staff">{t("viewMore")}</ViewLink>}
          >
            <Suspense
              fallback={
                <LoadingRegion label={t("loadingCommunity")}>
                  <StaffRowsSkeleton />
                </LoadingRegion>
              }
            >
              <StaffRows />
            </Suspense>
          </SectionCard>

          <div className="grid gap-3">
            <SectionCard
              title={t("newestHeading")}
              action={<ViewLink view="all">{t("viewMore")}</ViewLink>}
            >
              <Suspense fallback={<NewestMembersSkeleton />}>
                <NewestMembersList />
              </Suspense>
              <section
                aria-labelledby="find-member-heading"
                className="px-4 py-3"
              >
                <h3
                  id="find-member-heading"
                  className="mb-2 text-sm font-semibold"
                >
                  {t("searchHeading")}
                </h3>
                <MemberSearch id="find-member" />
              </section>
            </SectionCard>

            <SectionCard title={t("birthdaysHeading")}>
              <Suspense fallback={<BirthdaysSkeleton />}>
                <Birthdays />
              </Suspense>
            </SectionCard>
          </div>
        </div>
      </section>
    </>
  );
}
