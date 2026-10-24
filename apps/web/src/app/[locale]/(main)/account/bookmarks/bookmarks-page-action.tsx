"use server";

import type { ReactNode } from "react";
import {
  BookmarkPages,
  bookmarksPage,
} from "@/app/[locale]/(main)/account/bookmarks/bookmark-page";
import { call } from "@/lib/sermo/client";
import { requireIds } from "@/lib/sermo/ids";
import { drawnOrNull } from "@/lib/sermo/list-actions";

// A page of the member's bookmarks, drawn as the bookmarks page draws it, for the pager that turns
// the pages in place (`PageSwitch`). Null for a page with nothing on it (past the end) or one the
// backend refuses: the browser then opens the address as a page of its own.
export async function bookmarksPageAction(
  page: number,
): Promise<ReactNode | null> {
  requireIds(page);
  return drawnOrNull(async () => {
    const list = await bookmarksPage(page, call);
    if (list.rows.length === 0) return null;
    return <BookmarkPages page={page} list={list} />;
  });
}
