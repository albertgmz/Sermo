import { bookmarksList } from "@sermo/core/contracts";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import type * as z from "zod";
import { threadHref } from "@/app/[locale]/(main)/threads/[id]/pages";
import { BookmarkButton } from "@/components/forum/bookmark-button";
import { NumberedList } from "@/components/forum/numbered-list";
import { pagesOf } from "@/components/forum/page-window";
import { RelativeTime } from "@/components/forum/relative-time";
import { SectionHeader } from "@/components/forum/section-card";
import { UserLink } from "@/components/forum/user-link";
import type { ListRow } from "@/lib/list-pages";
import { read } from "@/lib/sermo/client";
import { membersFor } from "@/lib/sermo/members";
import { conversationOpenHref, threadOpenHref } from "@/lib/sermo/open-links";
import { BOOKMARKS_PER_PAGE } from "@/lib/sermo/page-sizes";

export const BOOKMARKS_PATH = "/account/bookmarks";

export type BookmarksPage = { rows: ListRow[]; total: number };

export type BookmarkItem = z.output<
  typeof bookmarksList.output
>["items"][number];
type Item = BookmarkItem;

// Where a bookmark leads: a post by its place in the thread, a thread or a conversation where the
// member left off (bookmarks are a member's own).
export function bookmarkHref(item: Item) {
  if (item.contentType === "conversation")
    return conversationOpenHref(item.contentId);
  if (item.contentType === "post" && item.threadId !== null)
    return threadHref(item.threadId, item.postPosition ?? 0, item.contentId);
  return threadOpenHref(item.threadId ?? item.contentId, true);
}

// One numbered page of the member's bookmarks, newest first, drawn, with how many bookmarks the
// numbered pages hold (only those the member can still see), which numbers them.
export async function bookmarksPage(
  page: number,
  reader: typeof read = read,
): Promise<BookmarksPage> {
  const [t, { items, total }] = await Promise.all([
    getTranslations("account.bookmarks"),
    reader(bookmarksList, { page }),
  ]);
  const member = await membersFor(items.map((item) => item.author));
  return {
    total: total ?? 0,
    rows: items.map((item) => ({
      key: String(item.id),
      node: (
        <article className="flex flex-wrap items-start gap-2 px-4 py-3">
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
                    user={member(item.author)}
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
      ),
    })),
  };
}

// The part of the bookmarks page that turns with its pages (`PageSwitch`): the pagers and the card
// of bookmarks.
export function BookmarkPages({
  page,
  list,
}: {
  page: number;
  list: BookmarksPage;
}) {
  const t = useTranslations("account.bookmarks");
  return (
    <NumberedList
      page={page}
      pages={pagesOf(list.total, BOOKMARKS_PER_PAGE)}
      path={BOOKMARKS_PATH}
      rows={list.rows}
      header={<SectionHeader title={t("sectionHeading")} />}
      className="overflow-hidden rounded-lg border bg-card"
    />
  );
}
