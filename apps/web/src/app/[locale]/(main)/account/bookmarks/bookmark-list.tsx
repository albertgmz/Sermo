import { bookmarksList } from "@sermo/core/contracts";
import { Bookmark } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { cursorOf } from "@/app/[locale]/(main)/account/notice";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { BookmarkButton } from "@/components/forum/bookmark-button";
import { EmptyState } from "@/components/forum/empty-state";
import { LoadMore } from "@/components/forum/load-more";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionCard } from "@/components/forum/section-card";
import { UserLink } from "@/components/forum/user-link";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";

type Item = z.output<typeof bookmarksList.output>["items"][number];

// Where a bookmark leads: a post by its place in the thread, a thread, a conversation.
export function bookmarkHref(item: Item) {
  if (item.contentType === "conversation")
    return `/conversations/${item.contentId}`;
  if (item.contentType === "post" && item.threadId !== null)
    return threadHref(item.threadId, item.postPosition ?? 0, item.contentId);
  return `/threads/${item.threadId ?? item.contentId}`;
}

// The member's bookmarks, newest first. A page may be short, or empty, while the backend still has
// more to look through (it skips what the member can no longer see).
export async function BookmarkList({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const cursor = cursorOf((await searchParams).cursor);
  const [t, { items, nextCursor }] = await Promise.all([
    getTranslations("account.bookmarks"),
    read(bookmarksList, { cursor }),
  ]);
  const member = await membersFor(items.map((item) => item.author));
  const more = nextCursor && (
    <LoadMore
      href={`/account/bookmarks?cursor=${encodeURIComponent(nextCursor)}`}
    >
      {t("loadMore")}
    </LoadMore>
  );

  if (items.length === 0) {
    return (
      more || (
        <EmptyState
          icon={Bookmark}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          className="rounded-lg border bg-card"
        />
      )
    );
  }

  return (
    <>
      <SectionCard title={t("sectionHeading")}>
        {items.map((item) => (
          <article
            key={item.id}
            className="flex flex-wrap items-start gap-2 px-4 py-3"
          >
            <div className="min-w-0 flex-[1_1_16rem]">
              <h3>
                <Link
                  href={bookmarkHref(item)}
                  className="inline-flex min-h-10 items-center text-sm font-semibold underline-offset-4 [overflow-wrap:anywhere] hover:underline md:min-h-0"
                >
                  {item.title}
                </Link>
              </h3>
              <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {t.rich("details", {
                  type: t(`types.${item.contentType}`),
                  author: () => (
                    <UserLink
                      user={member(item.author.id)}
                      className="font-medium"
                    />
                  ),
                  time: () => <RelativeTime date={item.createdAt} />,
                })}
              </p>
              {item.excerpt && (
                <p className="mt-1.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {item.excerpt}
                </p>
              )}
            </div>
            <BookmarkButton
              contentType={item.contentType}
              contentId={item.contentId}
              bookmarked
              className="min-w-10"
              labelClassName="sr-only"
            />
          </article>
        ))}
      </SectionCard>
      {more}
    </>
  );
}
