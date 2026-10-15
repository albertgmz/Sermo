import { Bookmark } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { bookmarksPage } from "@/app/[locale]/(main)/account/bookmarks/bookmark-page";
import { moreBookmarks } from "@/app/[locale]/(main)/account/bookmarks/more-bookmarks";
import { cursorOf } from "@/app/[locale]/(main)/account/notice";
import { EmptyState } from "@/components/forum/empty-state";
import { PagedList } from "@/components/forum/paged-list";
import { SectionHeader } from "@/components/forum/section-card";
import { pagesParam } from "@/lib/list-pages";

// The member's bookmarks, newest first.
export async function BookmarkList({
  searchParams,
}: {
  searchParams: Promise<{
    cursor?: string | string[];
    pages?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const cursor = cursorOf(params.cursor);
  const [t, first] = await Promise.all([
    getTranslations("account.bookmarks"),
    bookmarksPage(cursor),
  ]);

  if (first.rows.length === 0 && !first.nextCursor) {
    return (
      <EmptyState
        icon={Bookmark}
        title={t("emptyTitle")}
        description={t("emptyDescription")}
        className="rounded-lg border bg-card"
      />
    );
  }
  return (
    <PagedList
      first={first}
      more={moreBookmarks}
      pages={pagesParam(params.pages)}
      start={cursor}
      listKey={["bookmarks"]}
      hrefBase="/account/bookmarks"
      moreLabel={t("loadMore")}
      estimateSize={104}
      className="overflow-hidden rounded-lg border bg-card"
      header={<SectionHeader title={t("sectionHeading")} />}
    />
  );
}
