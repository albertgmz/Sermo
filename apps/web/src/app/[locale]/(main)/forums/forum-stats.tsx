import { threadsRanked } from "@sermo/core/contracts";
import { Eye, type LucideIcon, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Suspense } from "react";
import { CollapsiblePanel } from "@/components/forum/collapsible-panel";
import { RankNumber } from "@/components/forum/leaderboard";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { LoadingRegion, MemberRowSkeleton } from "@/components/forum/skeletons";
import { TabLinks } from "@/components/forum/tab-links";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { drawnOrNothing } from "@/components/widgets/drawn-or-nothing";
import { formatCompact } from "@/lib/format";
import { readIfAllowed } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { type ApiThread, threadCard, threadMembers } from "@/lib/sermo/threads";
import { cn } from "@/lib/utils";

type Figure = "replies" | "views";

const FIGURES: Record<
  Figure,
  { label: Figure; icon: LucideIcon; value: (thread: ApiThread) => number }
> = {
  replies: {
    label: "replies",
    icon: MessageCircle,
    value: (thread) => thread.replyCount,
  },
  views: { label: "views", icon: Eye, value: (thread) => thread.viewCount },
};

// `figure` is the one the list is about; it stays visible at every width. The backend does not
// say how many reactions a thread has, so the most reacted list shows its replies.
export const STATS_TABS = [
  {
    value: "posts",
    label: "postsTab",
    by: "latestPosts",
    figure: "replies",
  },
  {
    value: "threads",
    label: "threadsTab",
    by: "latestThreads",
    figure: "replies",
  },
  {
    value: "replied",
    label: "repliedTab",
    by: "mostReplied",
    figure: "replies",
  },
  {
    value: "reacted",
    label: "reactedTab",
    by: "mostReacted",
    figure: "replies",
  },
  {
    value: "viewed",
    label: "viewedTab",
    by: "mostViewed",
    figure: "views",
  },
] as const satisfies readonly {
  value: string;
  label: string;
  by: string;
  figure: Figure;
}[];

export type StatsTab = (typeof STATS_TABS)[number]["value"];

function ThreadRow({
  thread,
  member,
  rank,
  figure,
}: {
  thread: ApiThread;
  member: Awaited<ReturnType<typeof membersFor>>;
  rank: number;
  figure: Figure;
}) {
  const locale = useLocale();
  const t = useTranslations("forums.forumStats");
  const card = threadCard(thread, member);
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 md:px-4">
      <RankNumber rank={rank} medal={false} />
      <UserAvatar
        user={card.author.member}
        className="relative after:absolute after:-inset-1"
      />
      <div className="min-w-0 flex-1">
        <ThreadHoverCard
          thread={card}
          className="line-clamp-2 w-fit max-w-full text-sm font-medium [overflow-wrap:anywhere] hover:underline @lg:line-clamp-1"
        >
          {card.prefix && (
            <PrefixTag
              prefix={card.prefix}
              className="mr-1.5 align-(--prefix-offset)"
            />
          )}
          {card.title}
        </ThreadHoverCard>
        <p className="truncate text-xs text-muted-foreground">
          {t.rich("activity", {
            forumTitle: card.forum.title,
            forum: (chunks) => (
              <Link
                href={`/forums/${card.forum.id}`}
                className="font-medium underline-offset-4 hover:text-foreground hover:underline"
              >
                {chunks}
              </Link>
            ),
            time: () => <RelativeTime date={card.lastPost.createdAt} />,
            author: () => <UserLink user={card.lastPost.author.member} />,
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
              <dd>{formatCompact(value(thread), locale)}</dd>
            </div>
          );
        })}
      </dl>
    </li>
  );
}

// The panel of the forum statistics widget: `title` heads it, `limit` is how many threads a tab
// lists. Whether it is open is kept per panel: `instance` is null for the page's first one (kept
// under the name it has always had) and the widget's id for any other.
export function ForumStats({
  title,
  limit,
  active,
  hrefFor,
  instance,
}: {
  title: string;
  limit: number;
  active: StatsTab;
  hrefFor: (tab: StatsTab) => string;
  instance: number | null;
}) {
  const t = useTranslations("forums.forumStats");
  const part = instance === null ? "" : `${instance}-`;
  const tab =
    STATS_TABS.find((entry) => entry.value === active) ?? STATS_TABS[0];

  return (
    <CollapsiblePanel
      title={title}
      storageKey={`forum-stats-${part}open`}
      defaultOpen="md"
    >
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
          <StatsRows tab={tab} limit={limit} />
        </Suspense>
      </div>
    </CollapsiblePanel>
  );
}

// The rows load after the panel's frame and tabs: a read that is refused or fails leaves the panel
// without rows (logged), not the page broken.
async function StatsRows({
  tab,
  limit,
}: {
  tab: (typeof STATS_TABS)[number];
  limit: number;
}) {
  return drawnOrNothing("The forum statistics rows", async () => {
    const ranked = await readIfAllowed(threadsRanked, { by: tab.by, limit });
    if (!ranked) return null;
    const member = await membersFor(ranked.items.flatMap(threadMembers));
    return (
      <ol className="@container divide-y divide-border">
        {ranked.items.map((thread, index) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            member={member}
            rank={index + 1}
            figure={tab.figure}
          />
        ))}
      </ol>
    );
  });
}
