import { threadsRanked } from "@sermo/core/contracts";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { ThreadTitle } from "@/app/[locale]/(main)/_feed/thread-title";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import { CardSkeleton } from "@/components/forum/skeletons";
import { UserLink } from "@/components/forum/user-link";
import { Skeleton } from "@/components/ui/skeleton";
import type { WidgetBodyProps } from "@/components/widgets/widget-types";
import { formatCompact } from "@/lib/format";
import { readIfAllowed } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { threadMembers } from "@/lib/sermo/threads";

// The lists by date say who and when: the newest threads by the date they were started (the feed's
// Latest tab is the one by activity), the newest posts by their last post. The rankings are
// numbered and give each thread's replies and views. Each asks for what the feed shows, so the
// forums left out of the feed stay out of it.
export async function RankedThreads({
  widget,
  title,
}: WidgetBodyProps<"rankedThreads">) {
  const { by, limit } = widget.options;
  const ranked = await readIfAllowed(threadsRanked, { by, limit, feed: true });
  if (!ranked || ranked.items.length === 0) return null;
  const { items } = ranked;
  const [member, locale, format, t] = await Promise.all([
    membersFor(items.flatMap(threadMembers)),
    getLocale(),
    getFormatter(),
    getTranslations("widgets.rankedThreads"),
  ]);

  if (by === "latestThreads" || by === "latestPosts")
    return (
      <SectionCard title={title}>
        {items.map((thread) => (
          <div key={thread.id} className="px-4 py-2.5">
            <ThreadTitle thread={thread} member={member} />
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {by === "latestThreads" ? (
                <>
                  <UserLink
                    user={member(thread.author.id)}
                    className="font-medium"
                  />{" "}
                  · <RelativeTime date={thread.createdAt} />
                </>
              ) : (
                <>
                  <UserLink
                    user={member(thread.lastPost.user.id)}
                    className="font-medium"
                  />{" "}
                  · <RelativeTime date={thread.lastPost.postedAt} />
                </>
              )}
            </p>
          </div>
        ))}
      </SectionCard>
    );

  return (
    <SectionCard title={title}>
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

export function RankedThreadsSkeleton({
  widget,
}: {
  widget: WidgetBodyProps<"rankedThreads">["widget"];
}) {
  return (
    <CardSkeleton>
      {Array.from(
        { length: widget.options.limit },
        (_, index) => `row-${index}`,
      ).map((key) => (
        <div key={key} className="space-y-2 px-4 py-2.5">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </CardSkeleton>
  );
}
