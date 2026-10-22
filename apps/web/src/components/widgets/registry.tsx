import { ForumStatsSkeleton } from "@/components/forum/skeletons";
import { Birthdays, BirthdaysSkeleton } from "@/components/widgets/birthdays";
import { FeaturedThreads } from "@/components/widgets/featured-threads";
import {
  ForumLinks,
  ForumLinksSkeleton,
} from "@/components/widgets/forum-links";
import { ForumStatsWidget } from "@/components/widgets/forum-stats-widget";
import {
  MonthStandings,
  MonthStandingsSkeleton,
} from "@/components/widgets/month-standings";
import {
  RankedThreads,
  RankedThreadsSkeleton,
} from "@/components/widgets/ranked-threads";
import {
  RecentlyActive,
  RecentlyActiveSkeleton,
} from "@/components/widgets/recently-active";
import {
  ReferralLink,
  ReferralLinkSkeleton,
} from "@/components/widgets/referral-link";
import {
  SiteTotals,
  SiteTotalsSkeleton,
} from "@/components/widgets/site-totals";
import {
  SuggestedMembers,
  SuggestedMembersSkeleton,
} from "@/components/widgets/suggested-members";
import {
  TextWidget,
  TextWidgetSkeleton,
} from "@/components/widgets/text-widget";
import {
  TopReferrers,
  TopReferrersSkeleton,
} from "@/components/widgets/top-referrers";
import {
  VisitorCard,
  VisitorCardSkeleton,
} from "@/components/widgets/visitor-card";
import type {
  WidgetBodyProps,
  WidgetOf,
  WidgetType,
} from "@/components/widgets/widget-types";

// How the web draws a widget type.
//   Body      Called as a function (so it uses no hooks): it reads its own data and draws its own
//             frame, or nothing when it has nothing to show or its read is refused.
//   Skeleton  Drawn while the body loads; none draws nothing in the meantime (a block that is often
//             empty, like the featured threads, would otherwise flash).
export type WidgetEntry<K extends WidgetType> = {
  Body: (
    props: WidgetBodyProps<K>,
  ) => React.ReactNode | Promise<React.ReactNode>;
  Skeleton?: (props: { widget: WidgetOf<K> }) => React.ReactNode;
};

// The types this web app draws; a widget of any other type draws nothing.
export const WIDGET_ENTRIES: { [K in WidgetType]?: WidgetEntry<K> } = {
  forumStats: {
    Body: ForumStatsWidget,
    Skeleton: () => <ForumStatsSkeleton />,
  },
  rankedThreads: { Body: RankedThreads, Skeleton: RankedThreadsSkeleton },
  featured: { Body: FeaturedThreads },
  suggestedMembers: {
    Body: SuggestedMembers,
    Skeleton: SuggestedMembersSkeleton,
  },
  forumLinks: { Body: ForumLinks, Skeleton: ForumLinksSkeleton },
  visitorCard: { Body: VisitorCard, Skeleton: VisitorCardSkeleton },
  birthdays: { Body: Birthdays, Skeleton: BirthdaysSkeleton },
  topReferrers: { Body: TopReferrers, Skeleton: TopReferrersSkeleton },
  referralLink: { Body: ReferralLink, Skeleton: ReferralLinkSkeleton },
  monthStandings: { Body: MonthStandings, Skeleton: MonthStandingsSkeleton },
  text: { Body: TextWidget, Skeleton: TextWidgetSkeleton },
  recentlyActive: { Body: RecentlyActive, Skeleton: RecentlyActiveSkeleton },
  siteTotals: { Body: SiteTotals, Skeleton: SiteTotalsSkeleton },
};
