import "server-only";

import { bookmarksStatus } from "@sermo/core/contracts";
import { call } from "./client";
import { SermoError } from "./errors";
import { getViewer } from "./session";

// Which of a page's items the viewer has bookmarked, and whether they may add more.
export class BookmarkStatus {
  constructor(
    private readonly held: ReadonlySet<number>,
    private readonly mayAdd: boolean,
  ) {}

  // What an item's toggle shows: whether it is bookmarked, or null (no toggle) for an item that is
  // not bookmarked when the viewer lacks `bookmark.create`. Removing a bookmark needs nothing, so
  // a bookmarked item keeps its toggle.
  toggle(id: number): boolean | null {
    if (this.held.has(id)) return true;
    return this.mayAdd ? false : null;
  }
}

// Which of a page's items the signed-in viewer has bookmarked. Null when the backend cannot say:
// the page then draws no toggles rather than toggles that might lie. Callers ask for signed-in
// viewers only.
export async function bookmarkedAmong(
  contentType: "thread" | "post" | "conversation",
  ids: number[],
): Promise<BookmarkStatus | null> {
  const mayAdd =
    (await getViewer()).resolvedPermissions["bookmark.create"] !== false;
  if (ids.length === 0) return new BookmarkStatus(new Set(), mayAdd);
  try {
    const { bookmarked } = await call(bookmarksStatus, { contentType, ids });
    return new BookmarkStatus(new Set(bookmarked), mayAdd);
  } catch (error) {
    if (error instanceof SermoError) return null;
    throw error;
  }
}
