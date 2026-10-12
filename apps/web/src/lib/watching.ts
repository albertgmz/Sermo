import "server-only";

import { watchesListNodes, watchesListThreads } from "@sermo/core/contracts";
import { call } from "@/lib/sermo/client";

const PAGE = 100;

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
  do {
    const page = await list(cursor);
    const found = page.items.find(match);
    if (found) return found;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
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
