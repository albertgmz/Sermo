import { CollapsiblePanel } from "@/components/forum/collapsible-panel";
import { SectionCard } from "@/components/forum/section-card";
import {
  AccountHeaderSkeleton,
  BalanceSkeleton,
  BirthdaysSkeleton,
  CardSkeleton,
  CatalogueSkeleton,
  ConversationListSkeleton,
  EditorSkeleton,
  FeedSkeleton,
  FormRowSkeleton,
  ForumCategoriesSkeleton,
  ForumStatsSkeleton,
  HeadingSkeleton,
  LoadingRegion,
  MemberCardSkeleton,
  MemberListSkeleton,
  MemberRowSkeleton,
  MembersOverviewSkeleton,
  MonthHeroSkeleton,
  NewestMembersSkeleton,
  PodiumSkeleton,
  PostSkeleton,
  ProfileHeaderSkeleton,
  RaceWinnersSkeleton,
  ShopSkeleton,
  SidebarSkeleton,
  StaffRowsSkeleton,
  StatTileSkeleton,
  TabsSkeleton,
  TextSkeleton,
  ThreadRowSkeleton,
} from "@/components/forum/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

export function SkeletonDemos() {
  return (
    <div className="space-y-4">
      <SectionCard title="Skeleton primitive and loading region">
        <LoadingRegion label="Loading region example">
          <div className="flex items-center gap-3 p-4">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </LoadingRegion>
      </SectionCard>
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        {(
          [
            ["Thread row", <ThreadRowSkeleton key="thread" />],
            ["Member row", <MemberRowSkeleton key="member" />],
            ["Stat tile", <StatTileSkeleton key="stat" />],
            ["Text", <TextSkeleton key="text" />],
            ["Post", <PostSkeleton key="post" />],
            ["Form row", <FormRowSkeleton key="form" />],
            ["Editor", <EditorSkeleton key="editor" />],
            ["Tabs", <TabsSkeleton key="tabs" />],
            ["Heading", <HeadingSkeleton key="heading" />],
            ["Member list", <MemberListSkeleton key="members" rows={3} />],
            ["Member card", <MemberCardSkeleton key="card" />],
            ["Podium", <PodiumSkeleton key="podium" />],
            ["Staff rows", <StaffRowsSkeleton key="staff" />],
            ["Newest members", <NewestMembersSkeleton key="newest" />],
            ["Birthdays", <BirthdaysSkeleton key="birthdays" />],
            ["Conversations", <ConversationListSkeleton key="conversations" />],
          ] as const
        ).map(([label, demo]) => (
          <SectionCard key={label} title={label} contentClassName="p-3">
            {demo}
          </SectionCard>
        ))}
        <SectionCard title="Card: heading only">
          <div className="p-3">
            <CardSkeleton>
              <MemberRowSkeleton />
            </CardSkeleton>
          </div>
        </SectionCard>
        <SectionCard title="Card: heading and description">
          <div className="p-3">
            <CardSkeleton described>
              <MemberRowSkeleton />
            </CardSkeleton>
          </div>
        </SectionCard>
      </div>
      {(
        [
          ["Feed", <FeedSkeleton key="feed" />],
          ["Sidebar", <SidebarSkeleton key="sidebar" />],
          ["Forum stats", <ForumStatsSkeleton key="stats" />],
          ["Forum categories", <ForumCategoriesSkeleton key="forums" />],
          ["Profile header", <ProfileHeaderSkeleton key="profile" />],
          ["Account header", <AccountHeaderSkeleton key="account" />],
          ["Member of the month", <MonthHeroSkeleton key="month" />],
          ["Race and winners", <RaceWinnersSkeleton key="race" />],
          ["Members overview", <MembersOverviewSkeleton key="overview" />],
          ["Catalogue", <CatalogueSkeleton key="catalogue" />],
          ["Balance", <BalanceSkeleton key="balance" />],
          ["Shop", <ShopSkeleton key="shop" />],
        ] as const
      ).map(([label, demo]) => (
        <CollapsiblePanel
          key={label}
          title={`${label} skeleton`}
          storageKey={`styleguide-skeleton-${label}`}
          defaultOpen="md"
        >
          <div className="space-y-4 p-3">{demo}</div>
        </CollapsiblePanel>
      ))}
    </div>
  );
}
