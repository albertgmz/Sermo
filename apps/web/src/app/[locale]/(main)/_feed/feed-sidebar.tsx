import { nodesList, threadsRanked, usersList } from "@sermo/core/contracts";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { ThreadTitle } from "@/app/[locale]/(main)/_feed/thread-title";
import { followFromPage } from "@/app/[locale]/(main)/actions";
import { ForumIcon } from "@/components/forum/forum-icon";
import { MemberFollowButton } from "@/components/forum/member-follow-button";
import { MemberRow } from "@/components/forum/member-row";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import {
  CardSkeleton,
  LoadingRegion,
  MemberListSkeleton,
} from "@/components/forum/skeletons";
import { UserLink } from "@/components/forum/user-link";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCompact } from "@/lib/format";
import { read, readIfAllowed } from "@/lib/sermo/client";
import { membersFor, relationsFor } from "@/lib/sermo/members";
import { getViewer } from "@/lib/sermo/session";
import { threadMembers } from "@/lib/sermo/threads";

const LIST_SIZE = 5;
const SUGGESTIONS = 4;
// How many members are asked for, so that the viewer can be left out.
const CANDIDATES = 12;

const viewAllClass =
  "relative text-xs font-medium text-muted-foreground transition-colors after:absolute after:-inset-x-2 after:-inset-y-3.5 hover:text-foreground";

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
          <LoadingRegion label={t("loadingMembers")}>
            <MemberListSkeleton rows={SUGGESTIONS} />
          </LoadingRegion>
        }
      >
        <SuggestedMembers />
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
  const locale = await getLocale();
  const { items } = await read(threadsRanked, {
    by: "mostReacted",
    limit: LIST_SIZE,
    feed: true,
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
                  value: formatCompact(thread.replyCount, locale),
                })}{" "}
                ·{" "}
                {t("views", {
                  count: thread.viewCount,
                  value: formatCompact(thread.viewCount, locale),
                })}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </SectionCard>
  );
}

// The newest threads by the date they were started: "latest" says what it sorts by (the home
// feed's Latest tab is the one by activity).
async function LatestThreads() {
  const { items } = await read(threadsRanked, {
    by: "latestThreads",
    limit: LIST_SIZE,
    feed: true,
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
            <UserLink user={member(thread.author.id)} className="font-medium" />{" "}
            · <RelativeTime date={thread.createdAt} />
          </p>
        </div>
      ))}
    </SectionCard>
  );
}

// The most reacted-to members, without the viewer. The members they follow already are not left
// out: the button says "Following" for them. Nothing for a viewer who may not list members.
async function SuggestedMembers() {
  const { user } = await getViewer();
  const list = await readIfAllowed(usersList, {
    sort: "reactions",
    limit: CANDIDATES,
  });
  if (!list) return null;
  const suggestions = list.items
    .filter(({ card }) => card.id !== user?.id)
    .slice(0, SUGGESTIONS);
  const t = await getTranslations("home.feedSidebar");
  if (suggestions.length === 0) return null;
  const relation = await relationsFor(
    user?.id ?? null,
    suggestions.map(({ card }) => card.id),
  );
  return (
    <SectionCard title={t("membersTitle")}>
      {suggestions.map(({ card }) => (
        <MemberRow key={card.id} user={card} badgeLimit={1}>
          {user && (
            <MemberFollowButton
              userId={card.id}
              username={card.username}
              following={relation(card.id)?.following ?? false}
              action={followFromPage.bind(null, card.id)}
              className="h-10 md:h-8"
            />
          )}
        </MemberRow>
      ))}
    </SectionCard>
  );
}

async function FeedForums() {
  const locale = await getLocale();
  const { items } = await read(nodesList, {});
  const forums = items.filter((node) => node.type === "forum");
  const t = await getTranslations("home.feedSidebar");
  if (forums.length === 0) return null;
  return (
    <SectionCard
      title={t("forumsTitle")}
      action={
        <Link href="/" className={viewAllClass}>
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
            name={forum.iconKey ?? ""}
            className="size-4 shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 flex-1 truncate font-medium">
            {forum.title}
          </span>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {t.rich("threads", {
              count: forum.threadCount,
              value: formatCompact(forum.threadCount, locale),
              label: (chunks) => <span className="sr-only">{chunks}</span>,
            })}
          </span>
        </Link>
      ))}
    </SectionCard>
  );
}
