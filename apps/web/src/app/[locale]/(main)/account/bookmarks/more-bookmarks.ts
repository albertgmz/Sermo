"use server";

import { bookmarksPage } from "@/app/[locale]/(main)/account/bookmarks/bookmark-page";
import { call } from "@/lib/sermo/client";
import { endQuietly } from "@/lib/sermo/list-actions";

// A page of bookmarks after the first, drawn on the server so the names keep reading the LITE
// cookie. Called as the visitor scrolls; `null` is the first page.
export async function moreBookmarks(cursor: string | null) {
  return endQuietly(() => bookmarksPage(cursor ?? undefined, call));
}
