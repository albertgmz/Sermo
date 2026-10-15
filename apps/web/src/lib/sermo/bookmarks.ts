import "server-only";

import { bookmarksStatus } from "@sermo/core/contracts";
import { call } from "./client";
import { SermoError } from "./errors";
import { getViewer } from "./session";

// Which of a page's items the signed-in viewer has bookmarked. Null when the backend cannot say:
// the page then draws no toggles rather than toggles that might lie. Also null for a viewer whose
// groups lack `bookmark.create`, who has nothing to press. Callers ask for signed-in viewers only.
export async function bookmarkedAmong(
  contentType: "thread" | "post" | "conversation",
  ids: number[],
): Promise<Set<number> | null> {
  if (ids.length === 0) return new Set();
  if ((await getViewer()).resolvedPermissions["bookmark.create"] === false)
    return null;
  try {
    const { bookmarked } = await call(bookmarksStatus, { contentType, ids });
    return new Set(bookmarked);
  } catch (error) {
    if (error instanceof SermoError) return null;
    throw error;
  }
}
