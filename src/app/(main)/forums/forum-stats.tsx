import { Eye, Heart, type LucideIcon, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Suspense } from "react";
import { CollapsiblePanel } from "@/components/forum/collapsible-panel";
import { Leaderboard, RankNumber } from "@/components/forum/leaderboard";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { LoadingRegion, MemberRowSkeleton } from "@/components/forum/skeletons";
import { TabLinks } from "@/components/forum/tab-links";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import {
  getForumStats,
  getLeaderboard,
  type ForumStats as Stats,
  type ThreadView,
} from "@/lib/db";
import { formatCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

const ROWS = 10;

type Figure = "replies" | "reactions" | "views";

const FIGURES: Record<
  Figure,
  { label: Figure; icon: LucideIcon; value: (thread: ThreadView) => number }
> = {
  replies: {
    label: "replies",
    icon: MessageCircle,
    value: (thread) => thread.replyCount,
  },
  reactions: {
    label: "reactions",
    icon: Heart,
    value: (thread) => thread.reactionCount,
  },
  views: { label: "views", icon: Eye, value: (thread) => thread.views },
};

// `figure` is the one the list is about; it stays visible at every width.
export const STATS_TABS = [
  {
    value: "posts",
    label: "postsTab",
    list: "latestPosts",
    figure: "replies",
  },
  {
    value: "threads",
    label: "threadsTab",
    list: "latestThreads",
    figure: "replies",
  },
  {
    value: "replied",
    label: "repliedTab",
    list: "mostReplied",
    figure: "replies",
  },
  {
    value: "reacted",
    label: "reactedTab",
    list: "mostReacted",
    figure: "reactions",
  },
  {
    value: "viewed",
    label: "viewedTab",
    list: "mostViewed",
    figure: "views",
  },
] as const satisfies readonly {
  value: string;
  label: string;
  list: keyof Stats;
  figure: Figure;
}[];

export type StatsTab = (typeof STATS_TABS)[number]["value"];

function ThreadRow({
  thread,
  rank,
  figure,
}: {
  thread: ThreadView;
  rank: number;
  figure: Figure;
}) {
  const t = useTranslations("forums.forumStats");
  const last = thread.lastPost;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 md:px-4">
      <RankNumber rank={rank} medal={false} />
      <UserAvatar
        user={thread.author}
        className="relative after:absolute after:-inset-1"
      />
      <div className="min-w-0 flex-1">
        <ThreadHoverCard
          thread={thread}
          className="line-clamp-2 w-fit max-w-full text-sm font-medium [overflow-wrap:anywhere] hover:underline @lg:line-clamp-1"
        >
          {thread.prefix && (
            <PrefixTag
              prefix={thread.prefix}
              className="mr-1.5 align-(--prefix-offset)"
            />
          )}
          {thread.title}
        </ThreadHoverCard>
        <p className="truncate text-xs text-muted-foreground">
          {t.rich("activity", {
            forumTitle: thread.forum.title,
            forum: (chunks) => (
              <Link
                href={`/forums/${thread.forum.id}`}
                className="font-medium underline-offset-4 hover:text-foreground hover:underline"
              >
                {chunks}
              </Link>
            ),
            time: () => <RelativeTime date={last.createdAt} />,
            author: () => <UserLink user={last.author} />,
          })}
        </p>
      </div>
      <dl className="flex shrink-0 text-xs text-muted-foreground tabular-nums">
        {(Object.keys(FIGURES) as Figure[]).map((key) => {
          const { label, icon: Icon, value } = FIGURES[key];
          return (
            <div
              key={key}
              className={cn(
                "w-14 items-center justify-end gap-1",
                key === figure ? "flex text-foreground" : "hidden @lg:flex",
              )}
            >
              <dt>
                <Icon aria-hidden="true" className="size-3.5" />
                <span className="sr-only">{t(`aria.${label}`)}</span>
              </dt>
              <dd>{formatCompact(value(thread))}</dd>
            </div>
          );
        })}
      </dl>
    </li>
  );
}

export function ForumStats({
  active,
  hrefFor,
  viewerId,
}: {
  active: StatsTab;
  hrefFor: (tab: StatsTab) => string;
  viewerId?: number;
}) {
  const t = useTranslations("forums.forumStats");
  const tab =
    STATS_TABS.find((entry) => entry.value === active) ?? STATS_TABS[0];

  return (
    <CollapsiblePanel
      title={t("heading")}
      storageKey="forum-stats-open"
      defaultOpen="md"
    >
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0">
          <TabLinks
            tabs={STATS_TABS.map(({ value, label }) => ({
              value,
              label: t(label),
              href: hrefFor(value),
            }))}
            active={tab.value}
            label={t("aria.statistics")}
            className="px-1"
          />
          <Suspense
            fallback={
              <LoadingRegion label={t("aria.loadingActivity")}>
                <ol className="@container divide-y divide-border">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((row) => (
                    <li key={row}>
                      <MemberRowSkeleton />
                    </li>
                  ))}
                </ol>
              </LoadingRegion>
            }
          >
            <StatsRows tab={tab} />
          </Suspense>
        </div>
        <div className="min-w-0 border-t lg:border-t-0 lg:border-l">
          <h3 className="flex h-11 items-center border-b px-4 text-sm font-medium">
            {t("postersHeading")}
          </h3>
          <Suspense
            fallback={
              <LoadingRegion label={t("aria.loadingPosters")}>
                <div className="divide-y">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((row) => (
                    <MemberRowSkeleton key={row} />
                  ))}
                </div>
              </LoadingRegion>
            }
          >
            <Posters viewerId={viewerId} />
          </Suspense>
        </div>
      </div>
    </CollapsiblePanel>
  );
}

async function StatsRows({ tab }: { tab: (typeof STATS_TABS)[number] }) {
  const stats = await getForumStats(ROWS);
  return (
    <ol className="@container divide-y divide-border">
      {stats[tab.list].map((thread, index) => (
        <ThreadRow
          key={thread.id}
          thread={thread}
          rank={index + 1}
          figure={tab.figure}
        />
      ))}
    </ol>
  );
}

async function Posters({ viewerId }: { viewerId?: number }) {
  const posters = await getLeaderboard("posts", ROWS);
  return <Leaderboard members={posters} by="posts" viewerId={viewerId} />;
}
