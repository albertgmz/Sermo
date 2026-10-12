import { Cake, Crown, Flag } from "lucide-react";
import Link from "next/link";
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
  monthLabel,
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
import { monthOf } from "@/lib/standing";

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
  const winner = await getMemberOfTheMonth();
  return winner ? (
    <MonthHero
      winner={winner}
      action={<ViewLink view="month">Full standing</ViewLink>}
    />
  ) : (
    <div className="rounded-lg border bg-card">
      <EmptyState
        icon={Crown}
        title="No member of the month yet"
        description="Nobody earned points in the last complete month."
      />
    </div>
  );
}

async function RaceAndWinners({ viewerId }: { viewerId?: number }) {
  const [race, pastWinners] = await Promise.all([
    getCurrentMonthStanding(RACE),
    getPastWinners(PAST_WINNERS),
  ]);

  return (
    <div className="grid gap-3 md:grid-cols-2 md:items-start">
      <SectionCard
        title="This month's race"
        description={monthLabel(monthOf(new Date()))}
      >
        {race.length > 0 ? (
          <StandingList entries={race} viewerId={viewerId} />
        ) : (
          <EmptyState
            icon={Flag}
            title="The race has not started"
            description="The first post, reaction or referral of the month takes the lead."
          />
        )}
      </SectionCard>

      {pastWinners.length > 0 && (
        <SectionCard
          title="Past winners"
          action={<ViewLink view="month">View more</ViewLink>}
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
  const birthdays = await getBirthdays();
  return birthdays.length > 0 ? (
    birthdays.map((user) => (
      <MemberRow key={user.id} user={user} className="py-2">
        <Cake aria-hidden="true" className="size-4 shrink-0 text-primary" />
      </MemberRow>
    ))
  ) : (
    <p className="px-4 py-3 text-sm text-muted-foreground">
      No birthdays today.
    </p>
  );
}

// Every block reads its own data behind its own boundary; the headings and
// the frames of the cards are there from the first paint. The first fallback
// of a group announces it, the others stay silent.
export function Overview({ viewerId }: { viewerId?: number }) {
  return (
    <>
      <Suspense
        fallback={
          <LoadingRegion label="Loading member of the month…">
            <MonthHeroSkeleton />
          </LoadingRegion>
        }
      >
        <MemberOfTheMonth />
      </Suspense>

      <Suspense
        fallback={
          <LoadingRegion label="Loading this month's race…">
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
          Notable members
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {NOTABLE.map((view, index) => (
            <SectionCard
              key={view.value}
              title={view.label}
              action={<ViewLink view={view.value}>View more</ViewLink>}
            >
              <Suspense
                fallback={
                  index === 0 ? (
                    <LoadingRegion label="Loading notable members…">
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
          Community
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
          <SectionCard
            title="Staff"
            action={<ViewLink view="staff">View more</ViewLink>}
          >
            <Suspense
              fallback={
                <LoadingRegion label="Loading the community…">
                  <StaffRowsSkeleton />
                </LoadingRegion>
              }
            >
              <StaffRows />
            </Suspense>
          </SectionCard>

          <div className="grid gap-3">
            <SectionCard
              title="Newest members"
              action={<ViewLink view="all">View more</ViewLink>}
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
                  Find a member
                </h3>
                <MemberSearch id="find-member" />
              </section>
            </SectionCard>

            <SectionCard title="Today's birthdays">
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
