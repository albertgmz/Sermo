import { nodesList, threadsRanked } from "@sermo/core/contracts";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getFormatter, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ForumIcon } from "@/components/forum/forum-icon";
import { PrefixTag } from "@/components/forum/prefix-tag";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import { CardSkeleton, LoadingRegion } from "@/components/forum/skeletons";
import { ThreadHoverCard } from "@/components/forum/thread-hover-card";
import { UserLink } from "@/components/forum/user-link";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompact } from "@/lib/format";
import { call } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { type ApiThread, threadCard, threadMembers } from "@/lib/sermo/threads";

const LIST_SIZE = 5;

const viewAllClass =
  "relative text-xs font-medium text-muted-foreground transition-colors after:absolute after:-inset-x-2 after:-inset-y-3.5 hover:text-foreground";

function ThreadTitle({
  thread,
  member,
}: {
  thread: ApiThread;
  member: Awaited<ReturnType<typeof membersFor>>;
}) {
  const card = threadCard(thread, member);
  return (
    <ThreadHoverCard
      thread={card}
      className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere] hover:underline"
    >
      {card.prefix && (
        <PrefixTag
          prefix={card.prefix}
          className="mr-1.5 align-(--prefix-offset)"
        />
      )}
      {card.title}
    </ThreadHoverCard>
  );
}

export function FeedSidebar() {
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
  const { items } = await call(threadsRanked, {
    by: "mostReacted",
    limit: LIST_SIZE,
  });
  const member = await membersFor(items.flatMap(threadMembers));
  const t = await getTranslations("home.feedSidebar");
  const format = await getFormatter();
  if (items.length === 0) return null;
  return (
    <SectionCard title={t("trendingTitle")}>
      <ol className="divide-y divide-border">
        {items.map((thread, index) => (
          <li key={thread.id} className="flex gap-3 px-4 py-2.5">
            <span className="w-4 shrink-0 text-center text-sm font-bold tabular-nums text-muted-foreground">
              {format.number(index + 1)}
            </span>
            <div className="min-w-0 flex-1">
              <ThreadTitle thread={thread} member={member} />
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {t("replies", {
                  count: thread.replyCount,
                  value: formatCompact(thread.replyCount),
                })}{" "}
                ·{" "}
                {t("views", {
                  count: thread.viewCount,
                  value: formatCompact(thread.viewCount),
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
  const { items } = await call(threadsRanked, {
    by: "latestPosts",
    limit: LIST_SIZE,
  });
  const member = await membersFor(items.flatMap(threadMembers));
  const t = await getTranslations("home.feedSidebar");
  if (items.length === 0) return null;
  return (
    <SectionCard title={t("latestTitle")}>
      {items.map((thread) => (
        <div key={thread.id} className="px-4 py-2.5">
          <ThreadTitle thread={thread} member={member} />
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            <UserLink
              user={member(thread.lastPost.user.id)}
              className="font-medium"
            />{" "}
            · <RelativeTime date={thread.lastPost.postedAt} />
          </p>
        </div>
      ))}
    </SectionCard>
  );
}

async function FeedForums() {
  const { items } = await call(nodesList, {});
  const forums = items.filter((node) => node.type === "forum");
  const t = await getTranslations("home.feedSidebar");
  if (forums.length === 0) return null;
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
            name=""
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
