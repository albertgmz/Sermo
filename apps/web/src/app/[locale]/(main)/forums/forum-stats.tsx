import { threadsRanked, usersList } from "@sermo/core/contracts";
import {
  Eye,
  type LucideIcon,
  MessageCircle,
  MessageSquarePlus,
  MessageSquareText,
  MessagesSquare,
  ThumbsUp,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Suspense } from "react";
import type * as z from "zod";
import { CollapsiblePanel } from "@/components/forum/collapsible-panel";
import { RankNumber } from "@/components/forum/leaderboard";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { PresenceDot } from "@/components/forum/presence-dot";
import { RelativeTime } from "@/components/forum/relative-time";
import {
  ForumStatsRowsSkeleton,
  LoadingRegion,
} from "@/components/forum/skeletons";
import { TabLinks } from "@/components/forum/tab-links";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UserAvatar } from "@/components/forum/user-avatar";
import { UserLink } from "@/components/forum/user-link";
import { drawnOrNothing } from "@/components/widgets/drawn-or-nothing";
import { formatCompact, formatNumber } from "@/lib/format";
import { readIfAllowed } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { onlineMembers } from "@/lib/sermo/presence";
import { type ApiThread, threadCard, threadMembers } from "@/lib/sermo/threads";
import { cn } from "@/lib/utils";

// The tabs, as fcuba's forum statistics had them. The three "most" lists rank the threads active
// in the last 30 days (the backend's window), which their `note` says under the tabs.
export const STATS_TABS = [
  {
    value: "posts",
    label: "postsTab",
    by: "latestPosts",
    icon: MessageSquareText,
    note: null,
  },
  {
    value: "threads",
    label: "threadsTab",
    by: "latestThreads",
    icon: MessagesSquare,
    note: null,
  },
  {
    value: "replied",
    label: "repliedTab",
    by: "mostReplied",
    icon: MessageSquarePlus,
    note: "repliedNote",
  },
  {
    value: "reacted",
    label: "reactedTab",
    by: "mostReacted",
    icon: ThumbsUp,
    note: "reactedNote",
  },
  {
    value: "viewed",
    label: "viewedTab",
    by: "mostViewed",
    icon: Eye,
    note: "viewedNote",
  },
] as const satisfies readonly {
  value: string;
  label: string;
  by: string;
  icon: LucideIcon;
  note: string | null;
}[];

export type StatsTab = (typeof STATS_TABS)[number]["value"];

// The figures of a row. The backend does not say how many reactions a thread has, so the most
// reacted list (in the order of its opening post's reactions, as its note says) shows its replies
// and views too.
const FIGURES = [
  {
    label: "replies",
    icon: MessageCircle,
    value: (thread: ApiThread) => thread.replyCount,
  },
  {
    label: "views",
    icon: Eye,
    value: (thread: ApiThread) => thread.viewCount,
  },
] as const;

// A column after the title, at XenForo's width: a faint line on its left.
const CELL = "shrink-0 items-center border-l pl-2";

// One thread of a tab, on one line. As the panel narrows the columns go in XenForo's order (the
// panel's own width, not the window's): the date and the rank below 48rem, the replies and views
// below 42rem, the last poster below 36rem and the forum below 28rem, leaving the starter's
// avatar and the title. An unread thread's title is bold and opens at its first unread post.
function ThreadRow({
  thread,
  member,
  rank,
  online,
}: {
  thread: ApiThread;
  member: Awaited<ReturnType<typeof membersFor>>;
  rank: number;
  online: ReadonlySet<number> | null;
}) {
  const locale = useLocale();
  const t = useTranslations("forums.forumStats");
  const unread = useTranslations("forum.unreadDot");
  const card = threadCard(thread, member);
  return (
    <li className="flex min-h-8 items-stretch gap-2 px-2 text-compact even:bg-muted/50">
      <span className="hidden items-center @3xl:flex">
        <RankNumber rank={rank} medal={false} />
      </span>
      <span className="flex shrink-0 items-center py-1">
        <span className="relative">
          <UserAvatar user={card.author.member} size="sm" />
          {online && <PresenceDot online={online.has(thread.author.id)} />}
        </span>
      </span>
      <span className="flex min-w-0 flex-1 items-center py-1">
        <ThreadHoverCard
          thread={card}
          href={
            thread.isUnread
              ? `/threads/${thread.id}/unread`
              : `/threads/${thread.id}`
          }
          className={cn(
            // `relative` keeps the absolutely placed unread label inside the cut title.
            "relative block max-w-full truncate hover:underline",
            thread.isUnread ? "font-bold" : "font-medium",
          )}
        >
          {card.prefix && (
            <PrefixTag
              prefix={card.prefix}
              className="mr-1.5 align-(--prefix-offset)"
            />
          )}
          {card.title}
          {thread.isUnread && (
            <span className="sr-only"> ({unread("aria.label")})</span>
          )}
        </ThreadHoverCard>
      </span>
      <Link
        href={`/forums/${card.forum.id}`}
        className={cn(
          CELL,
          "hidden w-30 text-muted-foreground hover:text-foreground hover:underline @md:flex",
        )}
      >
        <span className="truncate">{card.forum.title}</span>
      </Link>
      <dl className="hidden text-muted-foreground tabular-nums @2xl:flex">
        {FIGURES.map(({ label, icon: Icon, value }) => (
          <div
            key={label}
            className={cn(CELL, "flex w-17.5 justify-end gap-1 pr-2")}
          >
            <dt>
              <Icon aria-hidden="true" className="size-3.5" />
              <span className="sr-only">{t(`aria.${label}`)}</span>
            </dt>
            <dd>{formatCompact(value(thread), locale)}</dd>
          </div>
        ))}
      </dl>
      <span
        className={cn(CELL, "hidden w-22.5 text-muted-foreground @3xl:flex")}
      >
        <span className="sr-only">{t("aria.lastPost")}</span>
        <RelativeTime date={card.lastPost.createdAt} className="truncate" />
      </span>
      <span className={cn(CELL, "hidden w-27.5 gap-1.5 @xl:flex")}>
        <UserAvatar user={card.lastPost.author.member} size="xs" />
        <UserLink
          user={card.lastPost.author.member}
          className="min-w-0 truncate"
        />
      </span>
    </li>
  );
}

// The forum statistics panel: `title` heads it, `limit` is how many threads a tab lists, and
// `topPosters` adds the column of the members with most messages, drawn only where the panel is
// wide enough (72rem, as XenForo hid it below a 1200-pixel window). Open until the visitor closes
// it, a choice kept per panel: `instance` is null for the page's first one (kept under the name
// it has always had) and the widget's id for any other.
export function ForumStats({
  title,
  limit,
  topPosters,
  active,
  hrefFor,
  instance,
}: {
  title: string;
  limit: number;
  topPosters: boolean;
  active: StatsTab;
  hrefFor: (tab: StatsTab) => string;
  instance: number | null;
}) {
  const t = useTranslations("forums.forumStats");
  const part = instance === null ? "" : `${instance}-`;
  const tab =
    STATS_TABS.find((entry) => entry.value === active) ?? STATS_TABS[0];

  return (
    <CollapsiblePanel title={title} storageKey={`forum-stats-${part}open`}>
      <div className="flex @container">
        <div className="min-w-0 flex-1">
          <TabLinks
            tabs={STATS_TABS.map(({ value, label, icon: Icon }) => ({
              value,
              label: t(label),
              href: hrefFor(value),
              icon: <Icon aria-hidden="true" />,
            }))}
            active={tab.value}
            label={t("aria.statistics")}
            className="px-1"
            arrow
          />
          {tab.note && (
            <p className="border-b px-2 py-1 text-caption text-muted-foreground">
              {t(tab.note)}
            </p>
          )}
          <Suspense
            fallback={
              <LoadingRegion label={t("aria.loadingActivity")}>
                <ForumStatsRowsSkeleton />
              </LoadingRegion>
            }
          >
            <StatsRows tab={tab} limit={limit} />
          </Suspense>
        </div>
        {topPosters && (
          // No placeholder: a visitor refused the member list gets no column, so none flashes.
          <Suspense fallback={null}>
            <TopPosters />
          </Suspense>
        )}
      </div>
    </CollapsiblePanel>
  );
}

// The rows load after the panel's frame and tabs: a read that is refused or fails leaves the panel
// without rows (logged), not the page broken. The lists leave out what the feed leaves out (the
// forums the site keeps out of it, such as archives, and the ones the viewer hides).
async function StatsRows({
  tab,
  limit,
}: {
  tab: (typeof STATS_TABS)[number];
  limit: number;
}) {
  return drawnOrNothing("The forum statistics rows", async () => {
    const [ranked, online] = await Promise.all([
      readIfAllowed(threadsRanked, { by: tab.by, limit, feed: true }),
      onlineMembers(),
    ]);
    if (!ranked) return null;
    const member = await membersFor(ranked.items.flatMap(threadMembers));
    return (
      <ol className="max-h-89 divide-y overflow-y-auto [scrollbar-width:thin]">
        {ranked.items.map((thread, index) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            member={member}
            rank={index + 1}
            online={online}
          />
        ))}
      </ol>
    );
  });
}

// The top posters' column, its heading level with the tabs.
function TopPostersFrame({ children }: { children: React.ReactNode }) {
  const t = useTranslations("forums.forumStats");
  return (
    <section className="hidden w-1/5 shrink-0 border-l @6xl:block">
      <h3 className="box-content flex h-11 items-center justify-center gap-1.5 border-b text-sm font-medium text-muted-foreground">
        <Users aria-hidden="true" className="size-4 shrink-0" />
        {t("topPosters")}
      </h3>
      {children}
    </section>
  );
}

type TopPoster = z.output<typeof usersList.output>["items"][number];

function TopPosterRows({ members }: { members: TopPoster[] }) {
  const locale = useLocale();
  const t = useTranslations("forums.forumStats");
  return (
    <ol className="max-h-89 divide-y overflow-y-auto [scrollbar-width:thin]">
      {members.map(({ card, postCount }) => (
        <li
          key={card.id}
          className="flex min-h-8 items-center gap-1.5 px-2 py-1 text-compact even:bg-muted/50"
        >
          <UserAvatar user={card} size="xs" />
          <UserLink user={card} className="min-w-0 flex-1 truncate" />
          <span className="shrink-0 text-muted-foreground tabular-nums">
            <span className="sr-only">{t("aria.posts")} </span>
            {formatNumber(postCount, locale)}
          </span>
        </li>
      ))}
    </ol>
  );
}

// The members with most messages; a visitor who may not see the member list gets no column.
async function TopPosters() {
  return drawnOrNothing("The forum statistics top posters", async () => {
    const top = await readIfAllowed(usersList, { sort: "posts", limit: 10 });
    if (!top || top.items.length === 0) return null;
    return (
      <TopPostersFrame>
        <TopPosterRows members={top.items} />
      </TopPostersFrame>
    );
  });
}
