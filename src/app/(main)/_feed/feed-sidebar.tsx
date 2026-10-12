import Link from "next/link";
import { useTranslations } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { FollowButton } from "@/app/(main)/members/wall-buttons";
import { ForumIcon } from "@/components/forum/forum-icon";
import { MemberRow } from "@/components/forum/member-row";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import {
  CardSkeleton,
  LoadingRegion,
  MemberListSkeleton,
} from "@/components/forum/skeletons";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UserLink } from "@/components/forum/user-link";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getCategories,
  getFollowing,
  getForumStats,
  getUsers,
  type ThreadView,
  type UserView,
} from "@/lib/db";
import { formatCompact } from "@/lib/format";
import { titleKeyForLevel } from "@/lib/levels";
import { can } from "@/lib/permissions";

const LIST_SIZE = 5;

const viewAllClass =
  "relative text-xs font-medium text-muted-foreground transition-colors after:absolute after:-inset-x-2 after:-inset-y-3.5 hover:text-foreground";

function ThreadTitle({ thread }: { thread: ThreadView }) {
  return (
    <ThreadHoverCard
      thread={thread}
      className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere] hover:underline"
    >
      {thread.prefix && (
        <PrefixTag
          prefix={thread.prefix}
          className="mr-1.5 align-(--prefix-offset)"
        />
      )}
      {thread.title}
    </ThreadHoverCard>
  );
}

export function FeedSidebar({ viewer }: { viewer: UserView | null }) {
  const t = useTranslations("home.feedSidebar");
  return (
    <>
      <Suspense
        fallback={
          <LoadingRegion label={t("loadingTrending")}>
            <CardSkeleton>
              {[1, 2, 3, 4, 5].map((row) => (
                <div key={row} className="space-y-2 px-4 py-2.5">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </CardSkeleton>
          </LoadingRegion>
        }
      >
        <Trending />
      </Suspense>

      <Suspense
        fallback={
          <LoadingRegion label={t("loadingLatest")}>
            <CardSkeleton>
              {[1, 2, 3, 4, 5].map((row) => (
                <div key={row} className="space-y-2 px-4 py-2.5">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </CardSkeleton>
          </LoadingRegion>
        }
      >
        <LatestThreads />
      </Suspense>

      <Suspense
        fallback={
          <LoadingRegion label={t("loadingMembers")}>
            <MemberListSkeleton rows={4} />
          </LoadingRegion>
        }
      >
        <SuggestedMembers viewer={viewer} />
      </Suspense>

      <Suspense
        fallback={
          <LoadingRegion label={t("loadingForums")}>
            <CardSkeleton>
              {[1, 2, 3, 4, 5, 6].map((row) => (
                <div key={row} className="flex h-11 items-center gap-3 px-4">
                  <Skeleton className="size-4" />
                  <Skeleton className="h-5 w-2/3" />
                </div>
              ))}
            </CardSkeleton>
          </LoadingRegion>
        }
      >
        <FeedForums />
      </Suspense>
    </>
  );
}

async function Trending() {
  const stats = await getForumStats(LIST_SIZE);
  const t = await getTranslations("home.feedSidebar");
  const format = await getFormatter();
  return (
    <SectionCard title={t("trendingTitle")}>
      <ol className="divide-y divide-border">
        {stats.mostReacted.map((thread, index) => (
          <li key={thread.id} className="flex gap-3 px-4 py-2.5">
            <span className="w-4 shrink-0 text-center text-sm font-bold tabular-nums text-muted-foreground">
              {format.number(index + 1)}
            </span>
            <div className="min-w-0 flex-1">
              <ThreadTitle thread={thread} />
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {t("reactions", {
                  count: thread.reactionCount,
                  value: formatCompact(thread.reactionCount),
                })}{" "}
                ·{" "}
                {t("replies", {
                  count: thread.replyCount,
                  value: formatCompact(thread.replyCount),
                })}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

async function LatestThreads() {
  const stats = await getForumStats(LIST_SIZE);
  const t = await getTranslations("home.feedSidebar");
  return (
    <SectionCard title={t("latestTitle")}>
      {stats.latestPosts.map((thread) => (
        <div key={thread.id} className="px-4 py-2.5">
          <ThreadTitle thread={thread} />
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <UserLink user={thread.lastPost.author} className="font-medium" /> ·{" "}
            <RelativeTime date={thread.lastPost.createdAt} />
          </p>
        </div>
      ))}
    </SectionCard>
  );
}

async function SuggestedMembers({ viewer }: { viewer: UserView | null }) {
  const [users, following] = await Promise.all([
    getUsers(),
    viewer ? getFollowing(viewer.id) : [],
  ]);
  const followedIds = new Set(following.map((user) => user.id));
  const suggestions = users
    .filter((user) => user.id !== viewer?.id && !followedIds.has(user.id))
    .toSorted((a, b) => b.followerCount - a.followerCount)
    .slice(0, 4);
  const t = await getTranslations("home.feedSidebar");
  const levels = await getTranslations("lib.levels");
  const roles = await getTranslations("lib.db.roles");
  return (
    <>
      {suggestions.length > 0 && (
        <SectionCard title={t("membersTitle")}>
          {suggestions.map((user) => {
            const title =
              (can(user, "customTitle") && user.customTitle) ||
              (user.role === "member"
                ? levels(titleKeyForLevel(user.level.level))
                : roles(user.role));
            return (
              <MemberRow key={user.id} user={{ ...user, title }}>
                <FollowButton user={user} viewer={viewer} following={false} />
              </MemberRow>
            );
          })}
        </SectionCard>
      )}
    </>
  );
}

async function FeedForums() {
  const categories = await getCategories();
  const forums = categories.flatMap((category) => category.forums);
  const t = await getTranslations("home.feedSidebar");
  return (
    <SectionCard
      title={t("forumsTitle")}
      action={
        <Link href="/forums" className={viewAllClass}>
          {t("viewAll")}
        </Link>
      }
    >
      {forums.slice(0, 6).map((forum) => (
        <Link
          key={forum.id}
          href={`/forums/${forum.id}`}
          className="flex min-h-11 items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-muted/30"
        >
          <ForumIcon
            name={forum.icon}
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 flex-1 truncate font-medium">
            {forum.title}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {t.rich("threads", {
              count: forum.threadCount,
              value: formatCompact(forum.threadCount),
              label: (chunks) => <span className="sr-only">{chunks}</span>,
            })}
          </span>
        </Link>
      ))}
    </SectionCard>
  );
}
