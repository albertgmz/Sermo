import { Bookmark } from "lucide-react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  BOOKMARKS_PATH,
  BookmarkPages,
  bookmarksPage,
} from "@/app/[locale]/(main)/account/bookmarks/bookmark-page";
import { bookmarksPageAction } from "@/app/[locale]/(main)/account/bookmarks/bookmarks-page-action";
import { EmptyState } from "@/components/forum/empty-state";
import { PageSwitch } from "@/components/forum/page-switch";
import {
  pageAddress,
  pageParam,
  pagesOf,
} from "@/components/forum/page-window";
import { BOOKMARKS_PER_PAGE } from "@/lib/sermo/page-sizes";

// The member's bookmarks, newest first, in numbered pages.
export async function BookmarkList({
  searchParams,
}: {
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const page = pageParam((await searchParams).page);
  const [t, first] = await Promise.all([
    getTranslations("account.bookmarks"),
    bookmarksPage(page),
  ]);
  // A page past the last one goes to the last one, as XenForo does.
  const pages = pagesOf(first.total, BOOKMARKS_PER_PAGE);
  if (page > pages) redirect(pageAddress(BOOKMARKS_PATH, {}, pages));

  if (first.total === 0) {
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
    <PageSwitch page={page} stamp={Date.now()} load={bookmarksPageAction}>
      <BookmarkPages page={page} list={first} />
    </PageSwitch>
  );
}
