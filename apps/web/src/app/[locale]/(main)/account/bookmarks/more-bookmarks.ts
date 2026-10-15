"use server";

import { bookmarksPage } from "@/app/[locale]/(main)/account/bookmarks/bookmark-page";

// The next page of bookmarks, drawn on the server so the names keep reading the LITE cookie.
// Called as the visitor scrolls.
export async function moreBookmarks(cursor: string) {
  return bookmarksPage(cursor);
}
