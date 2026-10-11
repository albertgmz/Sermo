import { Cake, Crown, Flag } from "lucide-react";
import Link from "next/link";
import { MemberSearch } from "@/app/(main)/members/member-search";
import { VIEWS, type ViewValue, viewHref } from "@/app/(main)/members/views";
import { EmptyState } from "@/components/forum/empty-state";
import { Leaderboard } from "@/components/forum/leaderboard";
import { MemberRow } from "@/components/forum/member-row";
import { SectionCard } from "@/components/forum/section-card";
import {
  MonthHero,
  monthLabel,
  StandingList,
  WinnerList,
} from "@/components/forum/standing";
import { UserAvatar } from "@/components/forum/user-avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
const RACE = 10;
const PAST_WINNERS = 5;
const NEWEST = 12;

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
      className="relative text-xs font-medium text-muted-foreground transition-colors after:absolute after:-inset-x-2 after:-inset-y-3.5 hover:text-foreground"
    >
      {children}
    </Link>
  );
}

function NewestMembers({ members }: { members: UserView[] }) {
  return (
    <ul className="flex flex-wrap gap-2 p-4">
      {members.map((member) => (
        <li key={member.id}>
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  href={`/members/${member.username}`}
                  aria-label={member.username}
                  className="block rounded-full"
                />
              }
            >
              <UserAvatar user={member} size="lg" link={false} />
            </TooltipTrigger>
            <TooltipContent>{member.username}</TooltipContent>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}

export async function Overview({ viewerId }: { viewerId?: number }) {
  const [winner, pastWinners, race, staff, newest, birthdays, ...rankings] =
    await Promise.all([
      getMemberOfTheMonth(),
      getPastWinners(PAST_WINNERS),
      getCurrentMonthStanding(RACE),
      getStaff(),
      getNewestMembers(NEWEST),
      getBirthdays(),
      ...NOTABLE.map((view) => getLeaderboard(view.ranking, TOP)),
    ]);

  return (
    <>
      {winner ? (
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
      )}

      <div className="grid gap-(--page-gap) xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
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

      <section aria-labelledby="notable-members" className="space-y-3 pt-2">
        <h2
          id="notable-members"
          className="text-lg font-semibold tracking-tight"
        >
          Notable members
        </h2>
        <div className="grid gap-(--page-gap) sm:grid-cols-2 xl:grid-cols-3">
          {NOTABLE.map((view, index) => (
            <SectionCard
              key={view.value}
              title={view.label}
              action={<ViewLink view={view.value}>View more</ViewLink>}
            >
              <Leaderboard
                members={rankings[index]}
                by={view.ranking}
                viewerId={viewerId}
              />
            </SectionCard>
          ))}
        </div>
      </section>

      <section aria-labelledby="community" className="space-y-3 pt-2">
        <h2 id="community" className="text-lg font-semibold tracking-tight">
          Community
        </h2>
        <div className="grid gap-(--page-gap) sm:grid-cols-2 sm:items-start">
          <SectionCard
            title="Staff"
            action={<ViewLink view="staff">View more</ViewLink>}
          >
            {staff.map((user) => (
              <MemberRow key={user.id} user={user} />
            ))}
          </SectionCard>

          <SectionCard title="Today's birthdays">
            {birthdays.length > 0 ? (
              birthdays.map((user) => (
                <MemberRow key={user.id} user={user}>
                  <Cake
                    aria-hidden="true"
                    className="size-4 shrink-0 text-primary"
                  />
                </MemberRow>
              ))
            ) : (
              <EmptyState
                icon={Cake}
                title="No birthdays today"
                description="Nobody in the community celebrates today."
                className="py-6"
              />
            )}
          </SectionCard>

          <SectionCard
            title="Newest members"
            action={<ViewLink view="all">View more</ViewLink>}
          >
            <NewestMembers members={newest} />
          </SectionCard>

          <SectionCard
            title="Find a member"
            description="Search the directory by username."
          >
            <div className="p-4">
              <MemberSearch id="find-member" />
            </div>
          </SectionCard>
        </div>
      </section>
    </>
  );
}
