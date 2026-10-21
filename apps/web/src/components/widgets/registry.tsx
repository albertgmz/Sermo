import { ForumStats } from "@/app/[locale]/(main)/forums/forum-stats";
import { ForumStatsSkeleton } from "@/components/forum/skeletons";
import { FeaturedThreads } from "@/components/widgets/featured-threads";
import {
  ForumLinks,
  ForumLinksSkeleton,
} from "@/components/widgets/forum-links";
import {
  RankedThreads,
  RankedThreadsSkeleton,
} from "@/components/widgets/ranked-threads";
import {
  SuggestedMembers,
  SuggestedMembersSkeleton,
} from "@/components/widgets/suggested-members";
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
    Body: ({ widget, title, context }) => (
      <ForumStats
        title={title}
        limit={widget.options.limit}
        active={context.stats}
        hrefFor={context.statsHref}
      />
    ),
    Skeleton: () => <ForumStatsSkeleton />,
  },
  rankedThreads: { Body: RankedThreads, Skeleton: RankedThreadsSkeleton },
  featured: { Body: FeaturedThreads },
  suggestedMembers: {
    Body: SuggestedMembers,
    Skeleton: SuggestedMembersSkeleton,
  },
  forumLinks: { Body: ForumLinks, Skeleton: ForumLinksSkeleton },
};
