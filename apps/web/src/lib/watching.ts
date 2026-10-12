import "server-only";

import { watchesListNodes, watchesListThreads } from "@sermo/core/contracts";
import { call } from "@/lib/sermo/client";
import { SermoError } from "@/lib/sermo/errors";

const PAGE = 100;
// A member who watches more than this is shown the button for a watch they do not have yet.
const MAX_PAGES = 20;

// The backend answers whether a member watches a thread or forum only as lists of the watches, so
// the lists are read until the one asked about is found.
async function find<T>(
  list: (cursor: string | undefined) => Promise<{
    items: T[];
    nextCursor: string | null;
  }>,
  match: (item: T) => boolean,
): Promise<T | null> {
  let cursor: string | undefined;
  try {
    for (let pages = 0; pages < MAX_PAGES; pages++) {
      const page = await list(cursor);
      const found = page.items.find(match);
      if (found) return found;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
  } catch (error) {
    if (!(error instanceof SermoError)) throw error;
  }
  return null;
}

export function threadWatch(threadId: number) {
  return find(
    (cursor) => call(watchesListThreads, { cursor, limit: PAGE }),
    (watch) => watch.threadId === threadId,
  );
}

export function nodeWatch(nodeId: number) {
  return find(
    (cursor) => call(watchesListNodes, { cursor, limit: PAGE }),
    (watch) => watch.nodeId === nodeId,
  );
}
