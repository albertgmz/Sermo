import "server-only";

import { threadBansList } from "@sermo/core/contracts";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";

// The active bans of one thread, or the backend's own refusal. `threadBans.list` needs
// `forum.threadBan` on the thread's forum, a permission of one forum that `auth.me` does not list
// (it holds the site-wide ones), so the page cannot tell beforehand whether the viewer may ask.
// It asks, and says what the backend answered when it refuses: the forum is not visible to them
// (not found) or they hold no such permission there (forbidden).
export async function lookupThreadBans(threadId: number) {
  try {
    const { items } = await call(threadBansList, { threadId });
    return { items, refusal: null };
  } catch (error) {
    if (
      error instanceof SermoError &&
      (error.code === "forbidden" || error.code === "not_found")
    ) {
      return { items: null, refusal: error.message };
    }
    throw error;
  }
}
